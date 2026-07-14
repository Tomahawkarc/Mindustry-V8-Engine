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

function setDrawColor(src, alpha){
    var c = src == null ? Color.white : src;
    Draw.color(c.r, c.g, c.b, alpha == null ? c.a : alpha);
}

function ensureBuffer(){
    if(rangeBuffer != null) return rangeBuffer;
    try{
        rangeBuffer = new FrameBuffer();
    }catch(e){
        rangeBuffer = null;
        rangeUseFbo = false;
    }
    return rangeBuffer;
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
    var buf = ensureBuffer();
    if(sh == null || buf == null || !rangeUseFbo){
        Draw.z(rangeLayer);
        return;
    }

    try{
        // Own FBO + own z-range, never touch Vars.renderer.effectBuffer.
        Draw.drawRange(rangeLayer, 0.5, function(){
            try{
                buf.resize(Core.graphics.getWidth(), Core.graphics.getHeight());
                buf.begin(Color.clear);
            }catch(eBegin){
                // If begin still fails for any reason, disable FBO path for this session.
                rangeUseFbo = false;
                try{ if(buf.isBound && buf.isBound()) buf.end(); }catch(eEnd){}
            }
        }, function(){
            try{
                if(!rangeUseFbo) return;
                buf.end();
                try{
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
                }catch(eUniform){}
                buf.blit(sh);
            }catch(eEnd){
                rangeUseFbo = false;
            }
        });
    }catch(eRange){
        rangeUseFbo = false;
        try{ Log.err("Mod Engine range drawRange failed", eRange); }catch(eLog2){}
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

function fboActive(){
    return rangeBatch && rangeUseFbo && rangeShader != null && rangeBuffer != null;
}

function rangeCircle(x, y, radius, color, alpha, phase){
    if(radius <= 0) return;
    function drawRange(){
        var a = alpha == null ? 0.35 : alpha;
        Draw.z(rangeLayer);

        if(fboActive()){
            // Solid opaque fill into private FBO — shader turns overlaps into a single union edge.
            setDrawColor(color, 1);
            Fill.circle(x, y, radius);
        }else{
            // Safe fallback: soft fill + outline (no FBO, no crash).
            setDrawColor(color, Math.min(0.10, a * 0.22));
            Fill.circle(x, y, radius);
            setDrawColor(color, 0.75);
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
