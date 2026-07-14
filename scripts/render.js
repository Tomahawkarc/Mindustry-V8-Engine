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
var Scl = Packages.arc.scene.ui.layout.Scl;

var rangeBatch = false;
var rangePreviousZ = 0;
// Use Layer.shields path when possible so radii behave like animated force shields.
var rangeLayer = Layer.shields + 0.05;
var rangeShader = null;
var rangeShaderFailed = false;

function copyColor(src, alpha){
    var c = src == null ? Color.white : src;
    return new Color(c.r, c.g, c.b, alpha == null ? 1 : alpha);
}

function shader(){
    if(rangeShader != null || rangeShaderFailed) return rangeShader;
    try{
        // Prefer dedicated mod path under aassets/shaders; tree also resolves shaders/*.frag
        var frag = null;
        try{ frag = Vars.tree.get("shaders/rangezone.frag"); }catch(eTree){}
        if(frag == null || !frag.exists()){
            try{ frag = Vars.tree.get("aassets/shaders/rangezone.frag"); }catch(eTree2){}
        }
        if(frag == null || !frag.exists()){
            rangeShaderFailed = true;
            return null;
        }
        rangeShader = new Shader(Core.files.internal("shaders/screenspace.vert"), frag);
    }catch(e){
        rangeShader = null;
        rangeShaderFailed = true;
    }
    return rangeShader;
}

function beginRanges(){
    if(rangeBatch) return;
    rangeBatch = true;
    rangePreviousZ = Draw.z();
    var sh = shader();
    if(sh == null){
        // Fallback without FBO: still draw at shield layer with low alpha.
        Draw.z(rangeLayer);
        return;
    }

    // Mirror Renderer.animateShields:
    // Draw.drawRange(Layer.shields, 1f, () -> effectBuffer.begin(Color.clear), () -> { end; blit(Shaders.shield); });
    Draw.drawRange(rangeLayer, 1, function(){
        Vars.renderer.effectBuffer.begin(Color.clear);
    }, function(){
        Vars.renderer.effectBuffer.end();
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
        Vars.renderer.effectBuffer.blit(sh);
    });
    Draw.z(rangeLayer);
}

function endRanges(){
    if(!rangeBatch) return;
    Draw.flush();
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
        // No per-circle pulse scale: pulse would break silhouette union edges.
        var a = alpha == null ? 0.35 : alpha;
        Draw.z(rangeLayer);

        if(rangeBatch && rangeShader != null){
            // Solid opaque fill into effectBuffer — shader converts overlaps into a single union.
            Draw.color(copyColor(color, 1));
            Fill.circle(x, y, radius);
        }else{
            // Fallback outline style when FBO/shader unavailable.
            Draw.color(copyColor(color, Math.min(0.12, a * 0.28)));
            Fill.circle(x, y, radius);
            Draw.color(copyColor(color, 0.85));
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
