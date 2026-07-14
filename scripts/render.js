(function(){
var Color = Packages.arc.graphics.Color;
var Draw = Packages.arc.graphics.g2d.Draw;
var Fill = Packages.arc.graphics.g2d.Fill;
var Lines = Packages.arc.graphics.g2d.Lines;
var Blending = Packages.arc.graphics.Blending;
var Gl = Packages.arc.graphics.Gl;
var Mathf = Packages.arc.math.Mathf;
var Time = Packages.arc.util.Time;
var Drawf = Packages.mindustry.graphics.Drawf;
var Layer = Packages.mindustry.graphics.Layer;
var Core = Packages.arc.Core;
var Vars = Packages.mindustry.Vars;
var Scl = Packages.arc.util.Scaling;
var Shader = Packages.arc.graphics.gl.Shader;
var rangeBatch = false;
var rangePreviousZ = 0;
var rangeLayer = Layer.overlayUI + 0.017;
var rangeShader = null;

function shader(){
    if(rangeShader != null) return rangeShader;
    try{
        rangeShader = new Shader(Core.files.internal("shaders/screenspace.vert"), Vars.tree.get("shaders/rangezone.frag"));
    }catch(e){
        rangeShader = null;
    }
    return rangeShader;
}

function beginRanges(){
    if(rangeBatch) return;
    rangeBatch = true;
    rangePreviousZ = Draw.z();
    var sh = shader();
    if(sh == null){
        Draw.z(rangeLayer);
        return;
    }
    Draw.drawRange(rangeLayer, 0.02, function(){
        Vars.renderer.effectBuffer.begin(Color.clear);
    }, function(){
        Vars.renderer.effectBuffer.end();
        try{
            sh.bind();
            sh.setUniformf("u_time", Time.time);
            sh.setUniformf("u_offset", Core.camera.position.x - Core.camera.width / 2, Core.camera.position.y - Core.camera.height / 2);
            sh.setUniformf("u_texsize", Core.camera.width, Core.camera.height);
            sh.setUniformf("u_invsize", 1 / Core.camera.width, 1 / Core.camera.height);
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
        var pulse = 1 + Mathf.absin(Time.time + (phase || 0), 9, 0.01);
        Draw.z(rangeLayer);
        Draw.color(color, rangeBatch && rangeShader != null ? 1 : Math.min(0.16, (alpha || 0.35) * 0.38));
        Fill.circle(x, y, radius * pulse);
        if(rangeShader == null){
            Draw.color(color, 0.7);
            Drawf.dashCircle(x, y, radius * pulse, color);
        }
    }
    if(rangeBatch) drawRange();
    else withOverlay(drawRange);
}

function targetMarker(x, y, primary, secondary){
    withOverlay(function(){
        var pulse = 11 + Mathf.absin(Packages.arc.util.Time.time, 6, 3);
        Draw.color(primary, 0.14);
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
    });
}

function selectionRect(x1, y1, x2, y2, color){
    withOverlay(function(){
        var minX = Math.min(x1, x2), minY = Math.min(y1, y2);
        var width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
        Draw.color(color, 0.055);
        Fill.rect(minX + width / 2, minY + height / 2, width, height);
        Draw.color(color, 0.9);
        Lines.stroke(1.5);
        Drawf.dashRect(color, minX, minY, width, height);
    });
}

function selectedBuild(build, color){
    if(build == null) return;
    withOverlay(function(){
        Drawf.selected(build, color);
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
