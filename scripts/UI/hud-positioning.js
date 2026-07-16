/**
 * HUD Positioning — direct port of the WORKING logic from the attached runtime.js
 * + minimal lag fixes (caching + throttling).
 * The core functions (collectHudObstacles + hudStackBottom) are taken almost verbatim
 * from the version the user said "works absolutely".
 */

(function(){
    var Core = Packages.arc.Core;
    var Vec2 = Packages.arc.math.geom.Vec2;
    var Group = Packages.arc.scene.Group;
    var Vars = Packages.mindustry.Vars;
    var Time = Packages.arc.util.Time;

    var vecPool = [];
    function obtainVec(){ return vecPool.length ? vecPool.pop() : new Vec2(); }
    function freeVec(v){ if(v && vecPool.length < 12) vecPool.push(v); }

    var _cache = {};
    var _lastFrame = 0;
    var CACHE_TTL = 3; // very short TTL so expandable HUDs (arrow-down) are detected quickly

    // Track last seen sizes of obstacles so we can react when they expand/collapse
    var _lastSizes = {}; // key -> {w, h}
    var _needsRecompute = false;   // set when we saw any obstacle change size (arrow click etc)
    var _forceFresh = false;       // explicit full refresh request

    function clearCache(){
        _cache = {};
        _lastFrame = 0;
        _lastSizes = {};
        _needsRecompute = false;
        _forceFresh = false;
    }

    function getKey(anchor, x, width){
        try{
            var id = anchor && anchor.name ? String(anchor.name) : "a";
            return id + "|" + (x|0) + "|" + (width|0);
        }catch(e){ return "def"; }
    }

    function getObsKey(p){
        // position-only key (top-left) for live size tracking of expandable HUDs
        // size is stored in value; this way expand/collapse (different h at same x,y) is detected reliably
        return ((p.x|0) + "|" + (p.y|0));
    }

    // ====================== EXACT WORKING LOGIC ======================
    function belongsToModEngineHud(element){
        try{
            var current = element;
            while(current != null){
                var name = current.name == null ? "" : String(current.name);
                if(name.indexOf("mod-engine") === 0) return true;
                current = current.parent;
            }
        }catch(e){}
        return false;
    }

    function effectivelyVisible(element){
        try{
            var current = element;
            while(current != null){
                if(current.visible === false) return false;
                current = current.parent;
            }
        }catch(e){ return false; }
        return true;
    }

    function collectHudObstacles(element, anchor, x, width, out, depth){
        if(element == null || out.length > 64) return;
        if(depth === undefined) depth = 0;
        if(depth > 6) return;                    // slightly higher for expandable HUDs

        if(belongsToModEngineHud(element)) return;

        try{
            if(element === anchor || (anchor && element.isDescendantOf(anchor))) return;
        }catch(e){}

        try{
            var ew = element.getWidth(), eh = element.getHeight();
            var stageW = Core.scene.getWidth() || 800;
            var stageH = Core.scene.getHeight() || 600;

            var isCandidate = !belongsToModEngineHud(element) &&
               effectivelyVisible(element) &&
               ew >= 70 && eh >= 18 &&
               ew < stageW * 0.72 && eh < stageH * 0.45;

            if(isCandidate){
                var p = obtainVec();
                p.set(0, 0);
                element.localToStageCoordinates(p);

                var obsKey = getObsKey(p);
                var last = _lastSizes[obsKey];
                var sizeChanged = !last || last.w !== (ew|0) || last.h !== (eh|0);
                if(sizeChanged){
                    // another mod expanded (or collapsed) its HUD (e.g. arrow button) → force recompute
                    _cache = {};
                    _lastFrame = 0;
                    _needsRecompute = true;
                    _forceFresh = true;
                }
                _lastSizes[obsKey] = {w: (ew|0), h: (eh|0)};

                var overlap = Math.min(x + width, p.x + ew) - Math.max(x, p.x);
                if(overlap >= 28){
                    out.push({bottom: p.y, top: p.y + eh});
                }
                freeVec(p);
            }
        }catch(e){}

        try{
            if(element instanceof Group){
                var children = element.getChildren();
                var lim = Math.min(children.size, 90); // a bit more for dynamic children
                for(var i = 0; i < lim; i++){
                    collectHudObstacles(children.items[i], anchor, x, width, out, depth + 1);
                }
            }
        }catch(e){}
    }

    /**
     * This is the function that actually worked for the user.
     */
    function hudStackBottom(anchor, anchorBottom, x, width, hudHeight){
        if(anchor == null || Vars.ui == null || Vars.ui.hudGroup == null) return anchorBottom || 0;

        var key = getKey(anchor, x, width);
        var frame = Time.millis ? ((Time.millis() / 16) | 0) : 0;

        var force = _forceFresh || _needsRecompute;
        if(!force && _cache[key] !== undefined && (frame - _lastFrame) < CACHE_TTL){
            return _cache[key];
        }

        var obstacles = [];
        collectHudObstacles(Vars.ui.hudGroup, anchor, x, width, obstacles, 0);

        var boundary = anchorBottom;

        for(var pass = 0; pass < 12; pass++){
            var next = boundary;
            for(var i = 0; i < obstacles.length; i++){
                var ob = obstacles[i];
                if(ob.bottom < boundary - 0.5 &&
                   ob.top >= boundary - 14 && ob.top <= boundary + 14){
                    next = Math.min(next, ob.bottom);
                }
            }
            if(next >= boundary - 0.5) break;
            boundary = next;
        }

        _cache[key] = boundary;
        _lastFrame = frame;

        // clear the one-time force flags after use
        if(force){
            _forceFresh = false;
            _needsRecompute = false;
        }

        var minY = 4;
        if(hudHeight && (boundary - hudHeight < minY)){
            boundary = Math.max(boundary, minY + hudHeight);
        }
        return boundary;
    }

    function PositionController(){
        this.lastX = -99999;
        this.lastY = -99999;
        this.stable = 0;
        this.total = 0;
        this.force = false;
    }
    PositionController.prototype.shouldUpdate = function(cx, cy){
        this.total++;
        var dx = Math.abs(cx - this.lastX);
        var dy = Math.abs(cy - this.lastY);
        this.lastX = cx; this.lastY = cy;

        if(this.force){ this.force = false; return true; }
        if(dx > 2 || dy > 2){ this.stable = 0; return true; }
        this.stable++;

        if(this.stable < 5) return true;
        if(this.stable < 30) return (this.total % 5 === 0);
        return (this.total % 36 === 0); // very low when stable
    };
    PositionController.prototype.forceNext = function(){ this.force = true; this.stable = 0; };
    PositionController.prototype.reset = function(){
        this.lastX = this.lastY = -99999; this.stable = 0; this.total = 0;
    };

    var HudPositioning = {
        VERSION: "2.3-working-port-optimized",

        hudStackBottom: function(anchor, anchorBottom, hudX, hudWidth, hudHeight){
            return hudStackBottom(anchor, anchorBottom, hudX, hudWidth, hudHeight);
        },

        positionUnderOthers: function(holder, anchor, preferredX){
            if(!holder || !anchor) return;
            try{
                var p = obtainVec();
                p.set(0, 0);
                anchor.localToStageCoordinates(p);
                // Force fresh scan so expandable HUDs (arrow-down) are respected
                if(_needsRecompute || _forceFresh) {
                    _cache = {};
                    _lastFrame = 0;
                }
                var bottom = hudStackBottom(anchor, p.y, p.x, holder.getWidth(), holder.getHeight());
                holder.setPosition(preferredX !== undefined ? preferredX : p.x, bottom - holder.getHeight());
                freeVec(p);
            }catch(e){}
        },

        createController: function(){ return new PositionController(); },

        findBestAnchor: function(){
            try{
                var g = Vars.ui.hudGroup;
                if(!g) return null;
                var pri = ["statustable", "mobile buttons", "command"];
                for(var i=0; i<pri.length; i++){
                    var el = g.find(pri[i]);
                    if(el && el.hasParent() && effectivelyVisible(el)) return el;
                }
                var ch = g.getChildren();
                for(var j=0; j<ch.size; j++){
                    var c = ch.items[j];
                    if(c && c.hasParent() && effectivelyVisible(c)){
                        var nm = (c.name||"").toString().toLowerCase();
                        if(nm.indexOf("button")>=0 || nm.indexOf("hud")>=0 || nm.indexOf("command")>=0) return c;
                    }
                }
            }catch(e){}
            return null;
        },

        resetCache: clearCache,
        forceRefresh: function(){
            // set flags for immediate full recompute + live size tracking
            _needsRecompute = true;
            _forceFresh = true;
            // invalidate position cache but KEEP _lastSizes so expansion detection works across calls
            _cache = {};
            _lastFrame = 0;
        },

        createHudContainer: function(name){
            var t = new Table();
            t.name = name || "mod-engine-hud";
            t.setFillParent(true);
            t.touchable = Touchable.childrenOnly;
            return t;
        }
    };

    if(typeof module !== "undefined" && module.exports){
        module.exports = HudPositioning;
    } else {
        Packages.modengine = Packages.modengine || {};
        Packages.modengine.HudPositioning = HudPositioning;
    }
})();
