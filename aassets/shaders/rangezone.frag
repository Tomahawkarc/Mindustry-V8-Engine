#define HIGHP
#define wide 2.2
uniform sampler2D u_texture;
uniform vec2 u_texsize;
uniform vec2 u_invsize;
uniform float u_time;
uniform vec2 u_offset;
uniform float u_alpha;
varying vec2 v_texCoords;

void main(){
    vec2 T = v_texCoords.xy;
    vec2 coords = (T * u_texsize) + u_offset;
    vec4 color = texture2D(u_texture, T);
    vec2 v = u_invsize;

    vec4 nearMin = min(min(min(
        texture2D(u_texture, T + vec2(0.0, wide) * v),
        texture2D(u_texture, T + vec2(0.0, -wide) * v)),
        texture2D(u_texture, T + vec2(wide, 0.0) * v)),
        texture2D(u_texture, T + vec2(-wide, 0.0) * v));

    if(length(nearMin.rgb) < 0.0001 && length(color.rgb) > 0.01){
        float stripe = mod(coords.y / 2.0 + coords.x / 4.0 - u_time / 4.0, 32.0) / 28.0;
        gl_FragColor = vec4(color.rgb, (0.42 + stripe * 0.32) * u_alpha);
    }else{
        if(color.a >= 0.01 && color.a < 0.994){
            color.a = 0.15 * u_alpha;
        }else if(color.a >= 0.994){
            color.a = 0.22 * u_alpha;
        }
        gl_FragColor = color;
    }
}
