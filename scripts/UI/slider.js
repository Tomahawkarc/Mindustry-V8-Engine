(function(){
var Color = Packages.arc.graphics.Color;
var Draw = Packages.arc.graphics.g2d.Draw;
var Fill = Packages.arc.graphics.g2d.Fill;
var Mathf = Packages.arc.math.Mathf;
var Element = Packages.arc.scene.Element;
var InputListener = Packages.arc.scene.event.InputListener;

var defaultTrack = Color.valueOf("2a2d33");
var defaultTrackHighlight = Color.valueOf("3a3e46");
var defaultAccent = Color.valueOf("f4b842");
var defaultHandle = Color.valueOf("ffd166");

function roundedBar(x, y, width, height, radius){
    if(width <= 0 || height <= 0) return;
    var r = Math.min(radius, Math.min(height / 2, width / 2));
    if(width > r * 2){
        Fill.rect(x + width / 2, y + height / 2, width - r * 2, height);
    }
    Fill.circle(x + r, y + height / 2, r);
    if(width > r * 2) Fill.circle(x + width - r, y + height / 2, r);
}

function createNexusSlider(min, max, step, startValue, onChange, options){
    options = options || {};
    var track = options.track || defaultTrack;
    var trackHighlight = options.trackHighlight || defaultTrackHighlight;
    var fill = options.fill || defaultAccent;
    var handle = options.handle || defaultHandle;
    var glow = options.glow || fill;
    var range = Math.max(0.000001, max - min);
    var state = {
        value: Mathf.clamp(startValue, min, max),
        dragging: false,
        hover: 0
    };

    var slider = extend(Element, {
        draw: function(){
            var x = this.x;
            var y = this.y;
            var width = this.getWidth();
            var height = this.getHeight();
            var trackHeight = Math.max(6, height * 0.28);
            var trackY = y + (height - trackHeight) / 2;
            var radius = trackHeight / 2;
            var fraction = Mathf.clamp((state.value - min) / range, 0, 1);
            var handleX = x + radius + fraction * Math.max(0, width - radius * 2);
            var fillWidth = Math.max(0, handleX - x);

            var mouse = false;
            try{ mouse = this.hasMouse(); }catch(eMouse){}
            var target = state.dragging ? 1 : (mouse ? 0.55 : 0);
            state.hover = Mathf.lerpDelta(state.hover, target, 0.2);

            Draw.color(track);
            roundedBar(x, trackY, width, trackHeight, radius);

            Draw.color(trackHighlight, 0.55);
            if(width > trackHeight){
                Fill.rect(x + width / 2, trackY + trackHeight - 1, width - trackHeight, 1.5);
            }

            if(fillWidth > 0.5){
                Draw.color(fill);
                roundedBar(x, trackY, Math.max(trackHeight, fillWidth), trackHeight, radius);
            }

            var handleWidth = 5;
            var handleHeight = height * 0.9;
            var handleY = y + (height - handleHeight) / 2;
            if(state.hover > 0.01){
                Draw.color(glow, 0.35 * state.hover);
                Fill.rect(handleX, y + height / 2, handleWidth * 3.8, handleHeight * 1.16);
            }

            Draw.color(handle);
            Fill.rect(handleX, y + height / 2, handleWidth, handleHeight);
            Draw.color(fill, 0.9);
            Fill.rect(handleX, y + height / 2, 2, handleHeight * 0.7);
            Draw.reset();
        }
    });
    slider.setSize(360, 28);

    function applyFromX(localX){
        var width = slider.getWidth();
        var padding = Math.max(3, slider.getHeight() * 0.14);
        var usable = Math.max(1, width - padding * 2);
        var fraction = Mathf.clamp((localX - padding) / usable, 0, 1);
        var raw = min + fraction * range;
        if(step > 0) raw = Math.round((raw - min) / step) * step + min;
        var next = Mathf.clamp(raw, min, max);
        if(Math.abs(next - state.value) < 0.000001) return;
        state.value = next;
        if(onChange != null) onChange(next);
    }

    slider.addListener(extend(InputListener, {
        touchDown: function(event, x, y, pointer, button){
            try{ event.stop(); }catch(eStop){}
            state.dragging = true;
            applyFromX(x);
            return true;
        },
        touchDragged: function(event, x, y, pointer){
            try{ event.stop(); }catch(eStop){}
            applyFromX(x);
        },
        touchUp: function(event, x, y, pointer, button){
            try{ event.stop(); }catch(eStop){}
            state.dragging = false;
        }
    }));

    return {
        element: slider,
        getValue: function(){ return state.value; },
        setValue: function(value, notify){
            var next = Mathf.clamp(value, min, max);
            if(step > 0) next = Math.round((next - min) / step) * step + min;
            state.value = Mathf.clamp(next, min, max);
            if(notify === true && onChange != null) onChange(state.value);
        }
    };
}

module.exports = {
    createNexusSlider: createNexusSlider
};
})();
