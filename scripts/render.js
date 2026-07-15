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

var rangeBatch = false;
var rangePreviousZ = 0;
var rangeShader = null;
var rangeBuffer = null;
var rangeMaskTexture = null;
var rangeMaskRegion = null;
var rangeUseFbo = true;
var rangeResourcesChecked = false;

/* =============================================================================
 * SHIELD-SAFE FBO PASS (fix 1.6.1) + SELECTION FIX (green rect)
 *
 * Root cause of broken force shields: old begin/end runnables inside
 * Draw.drawRange() called Draw.flush() — which is re-entrant in the middle
 * of a sorted flush and shuffles the remaining queue entries.
 *
 * Root cause of missing selection rect: after endRanges(), the GL state
 * (texture bindings, shader program) was left in an undefined state, causing
 * subsequent withOverlay() draws (selectionRect, selectedBuild) to either
 * sample the wrong texture or render with the wrong shader — making them
 * invisible.
 *
 * Fix: use a private FBO pass WITHOUT Draw.drawRange(). All range circles
 * are drawn directly to the FBO via Draw.rect(mask) on a dedicated Z layer.
 * beginRanges() sets the Z, endRanges() does the blit + restores GL state
 * cleanly. withOverlay() pre-resets GL state so selection draws always work.
 * ============================================================================= */

function setDrawColor(src, alpha){
    var c = src == null ? Color.white : src;
    Draw.color(c.r, c.g, c.b, alpha == null ? c.a : alpha);
}

function ensureRangeResources(){
    if(rangeResourcesChecked) return rangeUseFbo && rangeShader != null && rangeBuffer != null && rangeMaskRegion != null;
    rangeResourcesChecked = true;
    try{
        var frag = null;
        try{ frag = Vars.tree.get("aassets/shaders/rangezone.frag"); }catch(eTree){}
        if(frag == null || !frag.exists()){
            try{ frag = Vars.tree.get("assets/shaders/rangezone.frag"); }catch(eTree2){}
        }
        var vert = Core.files.internal("shaders/screenspace.vert");
        if(frag == null || !frag.exists() || vert == null || !vert.exists()){
            rangeUseFbo = false;
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
        return true;
    }catch(e){
        rangeUseFbo = false;
        rangeShader = null;
        try{ if(rangeBuffer != null) rangeBuffer.dispose(); }catch(eDispose){}
        try{ if(rangeMaskTexture != null) rangeMaskTexture.dispose(); }catch(eMaskDispose){}
        rangeBuffer = null;
        rangeMaskTexture = null;
        rangeMaskRegion = null;
        try{ Log.err("Mod Engine private range FBO unavailable; using safe fallback", e); }catch(eLog){}
        return false;
    }
}

// Полный сброс GL-состояния: сбрасываем шейдер, blend, текстуры.
function fullGlReset(){
    try{
        Draw.shader(null);
        Draw.blend();
        Draw.color(Color.white);
        Draw.mixColor();
        // Перепривязываем белую текстуру атласа
        try{
            var wt = Core.atlas.white();
            if(wt != null && wt.texture != null) wt.texture.bind(0);
        }catch(eBind){}
        Draw.reset();
    }catch(e){}
}

// Рисуем FBO pass: захват, отрисовка всех накопленных кругов, блит шейдера.
function doFboPass(circles){
    if(circles == null || circles.length === 0) return;
    try{
        Draw.flush();

        rangeBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
        rangeBuffer.begin(Color.clear);

        // Рисуем все круги в FBO
        for(var i = 0; i < circles.length; i++){
            var c = circles[i];
            setDrawColor(c.color, 0.92);
            Draw.rect(rangeMaskRegion, c.x, c.y, c.radius * 2, c.radius * 2);
        }
        Draw.flush();
        rangeBuffer.end();

        // Блит FBO на экран через шейдер
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

        // Полный сброс GL после блита
        fullGlReset();
    }catch(e){
        try{ Log.err("Mod Engine FBO pass error", e); }catch(eLog){}
        try{ if(rangeBuffer != null) rangeBuffer.end(); }catch(eEnd){}
        rangeUseFbo = false;
        fullGlReset();
    }
}

// Собираем круги в массив — рисуем ВСЁ в одном FBO pass, без Draw.drawRange()
var rangeCircleQueue = [];

function beginRanges(){
    if(rangeBatch) return;
    rangeBatch = true;
    rangePreviousZ = Draw.z();
    rangeCircleQueue = [];
    ensureRangeResources();
}

function endRanges(){
    if(!rangeBatch) return;
    rangeBatch = false;

    if(rangeUseFbo && rangeCircleQueue.length > 0){
        doFboPass(rangeCircleQueue);
    }else if(rangeCircleQueue.length > 0){
        // Fallback: рисуем круги напрямую
        for(var i = 0; i < rangeCircleQueue.length; i++){
            var c = rangeCircleQueue[i];
            var a = c.alpha || 0.35;
            setDrawColor(c.color, Math.min(0.075, a * 0.18));
            Fill.circle(c.x, c.y, c.radius);
            setDrawColor(c.color, 0.78);
            Drawf.dashCircle(c.x, c.y, c.radius, c.color);
            Draw.reset();
        }
    }

    rangeCircleQueue = [];
    fullGlReset();
    Draw.z(rangePreviousZ);
}

function rangeCircle(x, y, radius, color, alpha, phase){
    if(radius <= 0) return;
    if(rangeBatch && rangeUseFbo){
        rangeCircleQueue.push({
            x: x, y: y, radius: radius,
            color: color,
            alpha: alpha == null ? 0.35 : alpha,
            phase: phase || 0
        });
    }else{
        // Без FBO — рисуем напрямую
        var a = alpha == null ? 0.35 : alpha;
        setDrawColor(color, Math.min(0.075, a * 0.18));
        Fill.circle(x, y, radius);
        setDrawColor(color, 0.78);
        Drawf.dashCircle(x, y, radius, color);
        Draw.reset();
    }
}

function withOverlay(drawer){
    var previous = Draw.z();
    // Полный сброс GL перед рисованием — критично для selectionRect после FBO pass
    fullGlReset();
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
