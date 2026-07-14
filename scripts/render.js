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
var Scl = Packages.arc.scene.ui.layout.Scl;
var Log = Packages.arc.util.Log;

var rangeBatch = false;
var rangePreviousZ = 0;
// CRITICAL: must NOT overlap native Layer.shields drawRange (shields .. shields+1),
// which already begins Vars.renderer.effectBuffer. Using the shared buffer there
// causes: IllegalArgumentException: Do not begin() twice.
var rangeLayer = Layer.overlayUI - 2.5;
var rangeShader = null;
var rangeShaderFailed = false;
var rangeBuffer = null;
var rangeUseFbo = true;

// Custom FBO for our ranges to avoid conflict with shields
var rangeFbo = null;
var rangeFboFailed = false;

function copyColor(src, alpha){
    var c = src == null ? Color.white : src;
    return new Color(c.r, c.g, c.b, alpha == null ? 1 : alpha);
}

function ensureFbo(){
    if(rangeFbo != null) return rangeFbo;
    try{
        rangeFbo = new FrameBuffer(Core.graphics.getWidth(), Core.graphics.getHeight());
    }catch(e){
        rangeFbo = null;
        rangeFboFailed = true;
        Log.err("Failed to create range FBO: " + e);
    }
    return rangeFbo;
}

function shader(){
    if(rangeShader != null || rangeShaderFailed) return rangeShader;
    try{
        var frag = null;
        try{ frag = Vars.tree.get("shaders/rangezone.frag"); }catch(eTree){}
        if(frag == null || !frag.exists()){
            try{ frag = Vars.tree.get("aassets/shaders/rangezone.frag"); }catch(eTree2){}
        }
        if(frag == null || !frag.exists()){
            try{ frag = Vars.tree.get("assets/shaders/rangezone.frag"); }catch(eTree3){}
        }
        if(frag == null || !frag.exists()){
            rangeShaderFailed = true;
            return null;
        }
        rangeShader = new Shader(Core.files.internal("shaders/screenspace.vert"), frag);
    }catch(e){
        rangeShader = null;
        rangeShaderFailed = true;
        try{ Log.err("Mod Engine range shader failed", e); }catch(eLog){}
    }
    return rangeShader;
}

function beginRanges(){
    if(rangeBatch) return;
    rangeBatch = true;
    rangePreviousZ = Draw.z();

    var sh = shader();
    var fbo = ensureFbo();
    
    if(sh == null || fbo == null || rangeFboFailed){
        Draw.z(rangeLayer);
        return;
    }

    try{
        // Use our own FBO instead of Vars.renderer.effectBuffer
        fbo.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
        fbo.begin(Color.clear);
        Draw.z(rangeLayer);
    }catch(eBegin){
        rangeFboFailed = true;
        try{ if(fbo.isBound && fbo.isBound()) fbo.end(); }catch(eEnd){}
        Draw.z(rangeLayer);
    }
}

function endRanges(){
    if(!rangeBatch) return;
    
    var sh = shader();
    var fbo = ensureFbo();
    
    try{
        Draw.flush();
        fbo.end();
        
        if(sh != null && fbo != null && !rangeFboFailed){
            // Bind shader and blit our FBO to screen
            sh.bind();
            sh.setUniformf("u_time", Time.time);
            sh.setUniformf("u_offset",
                Core.camera.position.x - Core.camera.width / 2,
                Core.camera.position.y - Core.camera.height / 2
            );
            sh.setUniformf("u_texsize", Core.camera.width, Core.camera.height);
            sh.setUniformf("u_invsize", 1 / Core.camera.width, 1 / Core.camera.height);
            try{ sh.setUniformf("u_dp", Scl.scl(1)); }catch(eDp){ sh.setUniformf("u_dp", 1); }
            sh.setUniformf("u_alpha", 1.0);
            
            // Draw our FBO texture to screen with correct blending
            Draw.color();
            Draw.rect(fbo.getTexture(), Core.camera.position.x, Core.camera.position.y, Core.camera.width, -Core.camera.height);
        }
    }catch(e){
        rangeFboFailed = true;
        Log.err("Mod Engine range draw failed", e);
    }finally{
        Draw.reset();
        Draw.z(rangePreviousZ);
        rangeBatch = false;
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

function fboActive(){
    return rangeBatch && !rangeFboFailed && rangeShader != null && rangeFbo != null;
}

function rangeCircle(x, y, radius, color, alpha, phase){
    if(radius <= 0) return;
    function drawRange(){
        var a = alpha == null ? 0.35 : alpha;
        Draw.z(rangeLayer);

        if(fboActive()){
            // Solid opaque fill into our FBO — shader turns overlaps into a single union edge.
            Draw.color(copyColor(color, 1));
            Fill.circle(x, y, radius);
        }else{
            // Safe fallback: soft fill + outline (no FBO, no crash).
            Draw.color(copyColor(color, Math.min(0.10, a * 0.22)));
            Fill.circle(x, y, radius);
            Draw.color(copyColor(color, 0.75));
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
        Draw.color(copyColor(primary, 0.14));
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
        Draw.color(copyColor(color, 0.055));
        Fill.rect(minX + width / 2, minY + height / 2, width, height);
        Draw.color(copyColor(color, 0.9));
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
