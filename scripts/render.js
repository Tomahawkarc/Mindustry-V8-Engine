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
// This pass owns its framebuffer and never touches Renderer.effectBuffer.
var rangeLayer = Layer.overlayUI - 2.5;
var rangeShader = null;
var rangeBuffer = null;
var rangeMaskTexture = null;
var rangeMaskRegion = null;
var rangeUseFbo = true;
var rangeResourcesChecked = false;
var rangeCaptureStarted = false;

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

        // Compile from source strings. This path cannot accidentally resolve to an atlas
        // error/nomap region, which is possible when image helpers are used for a shader file.
        rangeShader = new Shader(vert.readString(), frag.readString());
        rangeBuffer = new FrameBuffer();

        // Never use Fill.circle() for the FBO mask: it resolves the atlas "circle"
        // region and may return the nomap/error sprite in modded atlas configurations.
        // This private texture is generated once and cannot resolve to any atlas icon.
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

function restoreBatchState(){
    // ScreenQuad blit bypasses SpriteBatch and leaves its texture/program bound. If the
    // white atlas texture is not rebound, native ForceProjector Fill.poly calls can sample
    // the range FBO (or the atlas error page) while SpriteBatch still thinks white is bound.
    try{ Draw.shader(); }catch(eShaderReset){}
    try{ Draw.blend(); }catch(eBlend){}
    try{
        var white = Core.atlas.white();
        if(white != null && white.texture != null) white.texture.bind(0);
    }catch(eWhite){
        try{ Core.atlas.find("white").texture.bind(0); }catch(eWhiteFallback){}
    }
    try{
        var normal = Draw.getShader();
        if(normal != null){ normal.bind(); normal.apply(); }
    }catch(eNormalShader){}
    Draw.reset();
}

function disableFboAfterFailure(error){
    try{
        if(rangeCaptureStarted && rangeBuffer != null) rangeBuffer.end();
    }catch(eEnd){}
    rangeCaptureStarted = false;
    rangeUseFbo = false;
    restoreBatchState();
    try{ Log.err("Mod Engine range FBO disabled after render failure", error); }catch(eLog){}
}

function beginRanges(){
    if(rangeBatch) return;
    rangeBatch = true;
    rangePreviousZ = Draw.z();
    if(ensureRangeResources()){
        try{
            Draw.drawRange(rangeLayer, 0.5, function(){
                try{
                    Draw.flush();
                    rangeBuffer.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
                    rangeBuffer.begin(Color.clear);
                    rangeCaptureStarted = true;
                }catch(eBegin){
                    disableFboAfterFailure(eBegin);
                }
            }, function(){
                if(!rangeCaptureStarted || !rangeUseFbo) return;
                try{
                    Draw.flush();
                    rangeBuffer.end();
                    rangeCaptureStarted = false;

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
                    restoreBatchState();
                }catch(eBlit){
                    disableFboAfterFailure(eBlit);
                }
            });
        }catch(eRange){
            disableFboAfterFailure(eRange);
        }
    }
    Draw.z(rangeLayer);
}

function endRanges(){
    if(!rangeBatch) return;
    try{ Draw.flush(); }catch(eFlush){}
    Draw.reset();
    Draw.z(rangePreviousZ);
    rangeBatch = false;
}

function withOverlay(drawer){
    var previous = Draw.z();
    Draw.z(Layer.overlayUI);
    try{ drawer(); }finally{
        Draw.reset();
        Draw.z(previous);
    }
}

function rangeCircle(x, y, radius, color, alpha, phase){
    if(radius <= 0) return;
    function drawRange(){
        var a = alpha == null ? 0.35 : alpha;
        Draw.z(rangeLayer);

        if(rangeUseFbo && rangeShader != null && rangeBuffer != null && rangeMaskRegion != null){
            setDrawColor(color, 0.92);
            Draw.rect(rangeMaskRegion, x, y, radius * 2, radius * 2);
        }else{
            setDrawColor(color, Math.min(0.075, a * 0.18));
            Fill.circle(x, y, radius);
            setDrawColor(color, 0.78);
            Drawf.dashCircle(x, y, radius, color);
        }
        Draw.reset();
    }
    if(rangeBatch) drawRange();
    else withOverlay(drawRange);
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
