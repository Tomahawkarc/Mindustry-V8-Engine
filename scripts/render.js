(function(){
var Color = Packages.arc.graphics.Color;
var Draw = Packages.arc.graphics.g2d.Draw;
var Fill = Packages.arc.graphics.g2d.Fill;
var Lines = Packages.arc.graphics.g2d.Lines;
var Mathf = Packages.arc.math.Mathf;
var Time = Packages.arc.util.Time;
var Drawf = Packages.mindustry.graphics.Drawf;
var Layer = Packages.mindustry.graphics.Layer;
var Core = Packages.arc.Core;
var Vars = Packages.mindustry.Vars;
var Shader = Packages.arc.graphics.gl.Shader;
var FrameBuffer = Packages.arc.graphics.gl.FrameBuffer;
var Pixmap = Packages.arc.graphics.Pixmap;
var Texture = Packages.arc.graphics.Texture;
var TextureFilter = Packages.arc.graphics.Texture.TextureFilter;
var TextureRegion = Packages.arc.graphics.g2d.TextureRegion;
var Scl = Packages.arc.scene.ui.layout.Scl;
var Log = Packages.arc.util.Log;

// Fix для бага со щитами ForceProjector.
// Проблема: старый код использовал Draw.drawRange() для FBO-рендеринга радиусов.
// Это перехватывало Z-диапазон и ломало пайплайн Renderer.effectBuffer,
// который нужен для анимированных щитов (Layer.shields).
//
// Решение: Убираем Draw.drawRange() полностью. Вместо этого:
// 1. Собираем все круги в массив pendingCircles
// 2. endRanges() делает один FBO pass и блит на экран
// 3. Никакого перехвата чужих Z-слоёв — рисуем на Layer.shields - 2

var rangeActive = false;
var rangePreviousZ = 0;
var rangeDrawZ = Layer.shields - 2;
var rangeShader = null;
var rangeBuffer = null;
var rangeMaskTexture = null;
var rangeMaskRegion = null;
var rangeResourcesReady = false;
var rangeResourcesChecked = false;

var pendingCircles = [];

function setDrawColor(src, alpha){
    var c = src == null ? Color.white : src;
    Draw.color(c.r, c.g, c.b, alpha == null ? c.a : alpha);
}

function ensureRangeResources(){
    if(rangeResourcesChecked) return rangeResourcesReady;
    rangeResourcesChecked = true;
    try{
        var frag = null;
        try{ frag = Vars.tree.get("aassets/shaders/rangezone.frag"); }catch(eTree){}
        if(frag == null || !frag.exists()){
            try{ frag = Vars.tree.get("assets/shaders/rangezone.frag"); }catch(eTree2){}
        }
        var vert = Core.files.internal("shaders/screenspace.vert");
        if(frag == null || !frag.exists() || vert == null || !vert.exists()){
            rangeResourcesReady = false;
            return false;
        }

        rangeShader = new Shader(vert.readString(), frag.readString());
        rangeBuffer = new FrameBuffer();

        var maskPixmap = new Pixmap(128, 128);
        maskPixmap.fillCircle(64, 64, 63, Color.whiteRgba);
        rangeMaskTexture = new Texture(maskPixmap);
        maskPixmap.dispose();
        try{ rangeMaskTexture.setFilter(TextureFilter.linear, TextureFilter.linear); }catch(eFilter){}
        rangeMaskRegion = new TextureRegion(rangeMaskTexture);

        rangeResourcesReady = true;
        return true;
    }catch(e){
        rangeResourcesReady = false;
        rangeShader = null;
        try{ if(rangeBuffer != null) rangeBuffer.dispose(); }catch(eDispose){}
        try{ if(rangeMaskTexture != null) rangeMaskTexture.dispose(); }catch(eMaskDispose){}
        rangeBuffer = null;
        rangeMaskTexture = null;
        rangeMaskRegion = null;
        try{ Log.err("Mod Engine range FBO unavailable; using safe fallback", e); }catch(eLog){}
        return false;
    }
}

function safeReset(){
    try{
        Draw.shader();
        Draw.blend();
        Draw.color(Color.white);
        Draw.mixColor();
        try{
            var wt = Core.atlas.white();
            if(wt != null && wt.texture != null) wt.texture.bind(0);
        }catch(eW){}
        Draw.reset();
    }catch(e){}
}

function beginRanges(){
    if(rangeActive) return;
    rangeActive = true;
    rangePreviousZ = Draw.z();
    pendingCircles = [];
    ensureRangeResources();
}

function endRanges(){
    if(!rangeActive) return;
    rangeActive = false;

    if(rangeResourcesReady && pendingCircles.length > 0){
        try{
            Draw.flush();
            rangeBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
            rangeBuffer.begin(Color.clear);

            var cz = Draw.z();
            for(var i = 0; i < pendingCircles.length; i++){
                var c = pendingCircles[i];
                Draw.z(rangeDrawZ);
                setDrawColor(c.color, 0.92);
                Draw.rect(rangeMaskRegion, c.x, c.y, c.radius * 2, c.radius * 2);
            }
            Draw.z(cz);
            Draw.flush();
            rangeBuffer.end();

            rangeShader.bind();
            rangeShader.setUniformi("u_texture", 0);
            rangeShader.setUniformf("u_time", Time.time);
            rangeShader.setUniformf("u_offset",
                Core.camera.position.x - Core.camera.width / 2,
                Core.camera.position.y - Core.camera.height / 2
            );
            rangeShader.setUniformf("u_texsize", Core.camera.width, Core.camera.height);
            rangeShader.setUniformf("u_invsize", 1 / Core.camera.width, 1 / Core.camera.height);
            try{ rangeShader.setUniformf("u_dp", Scl.scl(1)); }catch(eDp){ rangeShader.setUniformf("u_dp", 1); }
            rangeShader.setUniformf("u_alpha", 1.0);
            rangeBuffer.blit(rangeShader);
            safeReset();
        }catch(e){
            try{ Log.err("Mod Engine FBO render error", e); }catch(eLog){}
            try{ if(rangeBuffer != null) rangeBuffer.end(); }catch(eEnd){}
            rangeResourcesReady = false;
            safeReset();
        }
    }else if(pendingCircles.length > 0){
        // Fallback без FBO
        Draw.z(rangeDrawZ);
        for(var i = 0; i < pendingCircles.length; i++){
            var c = pendingCircles[i];
            setDrawColor(c.color, Math.min(0.075, (c.alpha || 0.35) * 0.18));
            Fill.circle(c.x, c.y, c.radius);
            setDrawColor(c.color, 0.78);
            Drawf.dashCircle(c.x, c.y, c.radius, c.color);
            Draw.reset();
        }
    }

    pendingCircles = [];
    Draw.z(rangePreviousZ);
}

function rangeCircle(x, y, radius, color, alpha, phase){
    if(radius <= 0) return;

    if(rangeActive && rangeResourcesReady){
        pendingCircles.push({
            x: x, y: y, radius: radius,
            color: color, alpha: alpha == null ? 0.35 : alpha,
            phase: phase || 0
        });
    }else{
        var a = alpha == null ? 0.35 : alpha;
        var cz = Draw.z();
        try{
            Draw.z(rangeDrawZ);
            setDrawColor(color, Math.min(0.075, a * 0.18));
            Fill.circle(x, y, radius);
            setDrawColor(color, 0.78);
            Drawf.dashCircle(x, y, radius, color);
            Draw.reset();
        }catch(e){}
        finally{ Draw.z(cz); }
    }
}

function withOverlay(drawer){
    var previous = Draw.z();
    Draw.z(Layer.overlayUI);
    try{ drawer(); }finally{
        Draw.reset();
        Draw.z(previous);
    }
}

function targetMarker(x, y, primary, secondary){
    withOverlay(function(){
        var pulse = 11 + Mathf.absin(Time.time, 6, 3);
        setDrawColor(primary, 0.14);
        Fill.circle(x, y, pulse + 6);
        Drawf.dashCircle(x, y, pulse + 2, primary);
        Draw.color(primary);
        Lines.stroke(1.7);
        Lines.circle(x, y, pulse);
        Lines.line(x - pulse - 7, y, x - 4, y);
        Lines.line(x + 4, y, x + pulse + 7, y);
        Lines.line(x, y - pulse - 7, x, y - 4);
        Lines.line(x, y + 4, x, y + pulse + 7);
        Draw.color(secondary);
        Fill.circle(x, y, 2.8);
        Draw.reset();
    });
}

function selectionRect(x1, y1, x2, y2, color){
    withOverlay(function(){
        var minX = Math.min(x1, x2), minY = Math.min(y1, y2);
        var width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
        setDrawColor(color, 0.055);
        Fill.rect(minX + width / 2, minY + height / 2, width, height);
        setDrawColor(color, 0.9);
        Lines.stroke(1.5);
        Drawf.dashRect(color, minX, minY, width, height);
        Draw.reset();
    });
}

function selectedBuild(build, color){
    if(build == null) return;
    withOverlay(function(){
        Drawf.selected(build, color);
        Draw.reset();
    });
}

module.exports = {
    beginRanges: beginRanges,
    endRanges: endRanges,
    rangeCircle: rangeCircle,
    targetMarker: targetMarker,
    selectionRect: selectionRect,
    selectedBuild: selectedBuild
};
})();
