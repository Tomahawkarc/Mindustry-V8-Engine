/**
 *
 * Гарантирует, что элементы Mod Engine размещаются СТРОГО ПОД HUD-элементами
 * других модов, без наложения. Использует двухпроходный алгоритм с кэшированием
 * для предотвращения микро-фризов на слабых устройствах.
 *
 * Ключевые принципы:
 * - Object pooling (Vec2, массивы) — минимизация GC
 * - Кэш visibility с TTL — не проверяем каждый кадр одно и то же
 * - Адаптивный refresh rate — в покое обновляемся раз в 60 кадров
 * - Ограничение глубины рекурсии и числа детей — защита от сложных сцен
 * - Y-up координаты Mindustry: верх экрана = большие Y
 *
 * Исправления v2:
 * - Правильный двухпроходный алгоритм: сначала цепочка, потом коллизии
 * - Поддержка standalone HUD элементов с произвольными зазорами
 * - Правильная работа с anchor-элементом (не только справа, но и снизу)
 * - Сброс кэша при изменении размеров экрана/переключении модов
 */

(function(){
    var Core = Packages.arc.Core;
    var Vec2 = Packages.arc.math.geom.Vec2;
    var Table = Packages.arc.scene.ui.layout.Table;
    var Group = Packages.arc.scene.Group;
    var Touchable = Packages.arc.scene.event.Touchable;
    var Vars = Packages.mindustry.Vars;
    var Time = Packages.arc.util.Time;

    // ==========================================================================
    // VEC2 POOL — предотвращает создание новых Vec2 каждый кадр
    // ==========================================================================
    var VEC2_POOL_MAX = 16;
    var vec2Pool = [];
    var vec2PoolSize = 0;

    function obtainVec2(x, y){
        if(vec2PoolSize > 0){
            vec2PoolSize--;
            var v = vec2Pool[vec2PoolSize];
            vec2Pool[vec2PoolSize] = null;
            v.x = (x !== undefined ? x : 0);
            v.y = (y !== undefined ? y : 0);
            return v;
        }
        return new Vec2(x || 0, y || 0);
    }

    function freeVec2(v){
        if(v && vec2PoolSize < VEC2_POOL_MAX){
            vec2Pool[vec2PoolSize++] = v;
        }
    }

    // Переиспользуемые векторы (никогда не возвращаются в пул)
    var _vA = new Vec2();
    var _vB = new Vec2();
    var _vC = new Vec2();

    var obstacleBuffer = null;
    var OBSTACLE_BUFFER_MAX = 64; // макс число препятствий (каждое = 2 элемента: bottom, top)

    function ensureObstacleBuffer(){
        if(obstacleBuffer == null) obstacleBuffer = [];
        obstacleBuffer.length = 0;
        return obstacleBuffer;
    }

    var visibilityCache = {};
    var visibilityCacheFrame = 0;
    var VISIBILITY_CACHE_TTL = 30; // кадров

    function getCacheKey(element){
        try{
            return element.hashCode ? element.hashCode() : String(element);
        }catch(e){
            return String(element);
        }
    }

    function isEffectivelyVisible(element){
        if(element == null) return false;
        var key = getCacheKey(element);
        var entry = visibilityCache[key];
        if(entry !== undefined && (visibilityCacheFrame - entry.frame) < VISIBILITY_CACHE_TTL){
            return entry.visible;
        }
        var visible = true;
        var current = element;
        try{
            while(current != null){
                if(current.visible === false){ visible = false; break; }
                if(current.alpha !== undefined && current.alpha <= 0.005){ visible = false; break; }
                current = current.getParent ? current.getParent() : current.parent;
            }
        }catch(e){
            visible = false;
        }
        visibilityCache[key] = { visible: visible, frame: visibilityCacheFrame };
        return visible;
    }

    function clearVisibilityCache(){
        visibilityCache = {};
        visibilityCacheFrame = 0;
    }

    function belongsToModEngine(element){
        if(element == null) return false;
        var current = element;
        try{
            while(current != null){
                var name = current.name == null ? "" : String(current.name);
                if(name.indexOf("mod-engine") === 0 || name.indexOf("nexus") === 0){
                    return true;
                }
                current = current.getParent ? current.getParent() : current.parent;
            }
        }catch(e){}
        return false;
    }

    var _stageW = 0, _stageH = 0, _stageFrame = -1;
    function getStageSize(){
        if(visibilityCacheFrame !== _stageFrame){
            try{
                _stageW = Core.scene.getWidth();
                _stageH = Core.scene.getHeight();
            }catch(e){
                _stageW = Core.graphics.getWidth();
                _stageH = Core.graphics.getHeight();
            }
            _stageFrame = visibilityCacheFrame;
        }
        return { w: _stageW, h: _stageH };
    }

    // Параметры:
    //   element  — текущий элемент для проверки
    //   anchor   — наш якорный элемент (его и его родителей пропускаем)
    //   hudX     — левая граница нашего HUD в stage-координатах
    //   hudWidth — ширина нашего HUD
    //   out      — массив, куда добавляем [bottom, top] пары
    //   depth    — текущая глубина рекурсии
    var COLLECT_MAX_DEPTH = 10;
    var COLLECT_MAX_CHILDREN = 150;

    function collectObstacles(element, anchor, hudX, hudWidth, out, depth){
        if(element == null || out.length >= OBSTACLE_BUFFER_MAX * 2) return;
        if(depth === undefined) depth = 0;
        if(depth > COLLECT_MAX_DEPTH) return;

        // Пропускаем собственные элементы Mod Engine
        if(belongsToModEngine(element)) return;

        // Пропускаем anchor и его родителей/детей (мы уже знаем их позицию)
        try{
            if(anchor != null && (element === anchor || element.isDescendantOf(anchor))) return;
        }catch(eRel){}

        try{
            var ew = element.getWidth();
            var eh = element.getHeight();

            // Быстрый отсев: слишком маленькие элементы (пыль, spacer'ы)
            if(ew < 16 || eh < 10) return;

            // Слишком большие (весь экран) — обычно это fillParent-контейнеры
            var stage = getStageSize();
            if(ew >= stage.w * 0.75 && eh >= stage.h * 0.45) return;

            // Проверка видимости (с кэшем)
            if(!isEffectivelyVisible(element)) return;

            // Получаем stage-координаты
            _vA.set(0, 0);
            element.localToStageCoordinates(_vA);

            var elemX = _vA.x;
            var elemY = _vA.y;
            var elemTop = elemY + eh;

            // Быстрая отсечка по X: элемент слишком далеко по горизонтали
            if(elemX + ew < hudX - 40 || elemX > hudX + hudWidth + 40) return;

            // Проверяем горизонтальное перекрытие с нашим HUD
            var overlapLeft = Math.max(hudX, elemX);
            var overlapRight = Math.min(hudX + hudWidth, elemX + ew);
            var overlap = overlapRight - overlapLeft;

            // Требуем минимум 20px горизонтального перекрытия
            if(overlap >= 20){
                out.push(elemY);     // bottom
                out.push(elemTop);   // top
            }
        }catch(eBounds){}

        // Рекурсивно обходим детей
        try{
            if(element instanceof Group && depth < COLLECT_MAX_DEPTH){
                var children = element.getChildren();
                if(children != null && children.size > 0){
                    var limit = Math.min(children.size, COLLECT_MAX_CHILDREN);
                    for(var i = 0; i < limit; i++){
                        collectObstacles(children.items[i], anchor, hudX, hudWidth, out, depth + 1);
                    }
                }
            }
        }catch(eChildren){}
    }

    // Находит Y-позицию для размещения нашего HUD СТРОГО ПОД всеми другими
    // видимыми элементами в той же горизонтальной области.
    //
    // В Mindustry Y-up координаты: верх экрана = stageHeight, низ = 0.
    // "Под" = меньше Y (ниже по экрану).
    // Параметры:
    //   anchor       — якорный элемент (statustable, mobile buttons etc.)
    //   anchorBottom — Y низа anchor в stage-координатах
    //   hudX         — X нашего HUD в stage-координатах
    //   hudWidth     — ширина нашего HUD
    //   hudHeight    — высота нашего HUD (для проверки коллизий)
    // Возвращает: Y-координату для setPosition (низ нашего элемента)
    // ==========================================================================
    function hudStackBottom(anchor, anchorBottom, hudX, hudWidth, hudHeight){
        if(Vars.ui == null || Vars.ui.hudGroup == null) return anchorBottom;

        visibilityCacheFrame++;

        var out = ensureObstacleBuffer();
        collectObstacles(Vars.ui.hudGroup, anchor, hudX, hudWidth, out);

        var obstacles = out;
        var gap = 4; // px зазора
        var boundary = anchorBottom; // начинаем от низа якоря

        // ================================================================
        // PASS 1: Цепочка элементов, прикреплённых к anchor
        //
        // Идём вниз по цепочке элементов, которые непосредственно
        // прикреплены к anchor или друг к другу (допуск ±14 px).
        // Это быстро находит нативные HUD элементы и моды,
        // которые корректно стыкуются.
        // ================================================================
        var chainTolerance = 14;
        for(var pass = 0; pass < 16; pass++){
            var nextBoundary = boundary;
            for(var i = 0; i < obstacles.length; i += 2){
                var obsBottom = obstacles[i];
                var obsTop = obstacles[i + 1];
                // Элемент начинается примерно там, где заканчивается цепочка
                if(obsTop >= boundary - chainTolerance && obsTop <= boundary + chainTolerance){
                    // Его низ должен быть ниже верха (реальный элемент, не артефакт)
                    if(obsBottom < boundary - 0.5){
                        nextBoundary = Math.min(nextBoundary, obsBottom);
                    }
                }
            }
            if(nextBoundary >= boundary - 0.5) break; // цепочка кончилась
            boundary = nextBoundary;
        }

        // Сторонний мод мог разместить HUD с зазором или независимо
        // от цепочки. Проверяем перекрытия с нашим будущим прямоугольником.
        // Если есть коллизия — сдвигаемся ПОД препятствие.
        // Итерируем до стабильности (макс 8 проходов).
        // ================================================================
        if(hudHeight > 10 && obstacles.length > 0){
            for(var iter = 0; iter < 8; iter++){
                var pushed = false;
                var ourTop = boundary;               // верх нашего HUD
                var ourBottom = boundary - hudHeight; // низ нашего HUD
                for(var j = 0; j < obstacles.length; j += 2){
                    var oBottom = obstacles[j];
                    var oTop = obstacles[j + 1];
                    // Условие: oTop > ourBottom + gap (верх препятствия выше низа нашего HUD)
                    //        && oBottom < ourTop - gap (низ препятствия ниже верха нашего HUD)
                    if(oTop > ourBottom + gap && oBottom < ourTop - gap){
                        // Сдвигаемся ПОД препятствие
                        boundary = oBottom - gap;
                        pushed = true;
                        break;
                    }
                }
                if(!pushed) break;
            }
        }

        var stage = getStageSize();
        var minY = 4;
        if(boundary - hudHeight < minY){
            // Не помещаемся снизу — возвращаем хотя бы minY + hudHeight
            boundary = Math.max(boundary, minY + hudHeight);
        }
        // Не даём уйти выше верха экрана
        if(boundary > stage.h - 4){
            boundary = stage.h - 4;
        }

        return boundary;
    }

    function PositionController(){
        this.lastX = -9999;
        this.lastY = -9999;
        this.stableFrames = 0;
        this.totalFrames = 0;
    }

    PositionController.prototype = {
        // Возвращает true, если пора обновлять позицию
        shouldUpdate: function(currentX, currentY){
            this.totalFrames++;

            var dx = Math.abs(currentX - this.lastX);
            var dy = Math.abs(currentY - this.lastY);

            this.lastX = currentX;
            this.lastY = currentY;

            if(dx > 1.5 || dy > 1.5){
                // Значительное движение — сбрасываем стабильность
                this.stableFrames = 0;
                return true;
            }

            this.stableFrames++;

            if(this.stableFrames < 6){
                // Первые 6 кадров после движения — каждый кадр
                return true;
            }

            if(this.stableFrames < 30){
                // Переходный период — каждый 8-й кадр
                return (this.totalFrames % 8) === 0;
            }

            // Стабильное состояние — каждый 60-й кадр (~1 сек)
            return (this.totalFrames % 60) === 0;
        },

        reset: function(){
            this.lastX = -9999;
            this.lastY = -9999;
            this.stableFrames = 0;
            this.totalFrames = 0;
        },

        // Форсировать обновление на следующем вызове
        forceNext: function(){
            this.stableFrames = 0;
        }
    };

    function createHudContainer(name, touchable){
        var root = new Table();
        root.name = name || "mod-engine-hud";
        root.setFillParent(true);
        root.touchable = touchable || Touchable.childrenOnly;
        root.visible = true;
        return root;
    }

    function findBestAnchor(){
        if(Vars.ui == null || Vars.ui.hudGroup == null) return null;

        // Приоритет 1: statustable (десктоп)
        try{
            var st = Vars.ui.hudGroup.find("statustable");
            if(st != null && st.hasParent() && isEffectivelyVisible(st)) return st;
        }catch(e){}

        // Приоритет 2: mobile buttons (мобилки)
        try{
            var mb = Vars.ui.hudGroup.find("mobile buttons");
            if(mb != null && mb.hasParent() && isEffectivelyVisible(mb)) return mb;
        }catch(e){}

        return null;
    }

    var HudPositioning = {
        // Версия для проверки совместимости
        VERSION: "2.0.0",

        // Основная функция позиционирования
        // Возвращает {x, y} — позицию для setPosition(x, y) элемента
        stackBelow: function(anchor, hudWidth, hudHeight, preferredX){
            if(anchor == null) return { x: preferredX || 0, y: 100 };

            _vB.set(0, 0);
            anchor.localToStageCoordinates(_vB);

            var anchorX = _vB.x;
            var anchorY = _vB.y;
            var anchorH = anchor.getHeight();
            var anchorBottom = anchorY; // низ anchor'а в stage-координатах

            var hudX = preferredX !== undefined ? preferredX : anchorX;
            var bottom = hudStackBottom(anchor, anchorBottom, hudX, hudWidth, hudHeight);

            return { x: hudX, y: bottom - hudHeight };
        },

        positionUnderOthers: function(holder, anchor, preferredX){
            if(holder == null || anchor == null) return;

            var pos = this.stackBelow(anchor, holder.getWidth(), holder.getHeight(), preferredX);
            holder.setPosition(pos.x, pos.y);
        },

        // Создать update-callback для постоянного отслеживания позиции
        // Использует PositionController для адаптивного refresh rate
        createUpdateCallback: function(holder, anchor, controller, preferredX){
            var ctrl = controller || new PositionController();
            var point = obtainVec2();

            return function(){
                try{
                    if(holder == null || !holder.visible) return;
                    if(anchor == null || !anchor.hasParent()) return;

                    point.set(0, 0);
                    anchor.localToStageCoordinates(point);

                    if(ctrl.shouldUpdate(point.x, point.y)){
                        HudPositioning.positionUnderOthers(holder, anchor, preferredX !== undefined ? preferredX : point.x);
                    }
                }catch(e){}
            };
        },

        // Быстрое позиционирование (без контроллера) — для единоразовых операций
        quickPosition: function(holder, anchor, preferredX){
            this.positionUnderOthers(holder, anchor, preferredX);
        },

        // Создать HUD-контейнер
        createHudContainer: createHudContainer,

        // Найти лучший anchor
        findBestAnchor: findBestAnchor,

        // hudStackBottom — доступна для прямого использования
        hudStackBottom: function(anchor, anchorBottom, hudX, hudWidth, hudHeight){
            return hudStackBottom(anchor, anchorBottom, hudX, hudWidth, hudHeight);
        },

        // Принудительно сбросить все кэши
        resetCache: function(){
            clearVisibilityCache();
            if(obstacleBuffer != null) obstacleBuffer.length = 0;
        },

        // Проверить, принадлежит ли элемент Mod Engine
        belongsToModEngine: belongsToModEngine,

        // Проверить видимость элемента (с кэшем)
        isVisible: isEffectivelyVisible,

        // Сбросить кэш видимости (полезно при переключении модов/экранов)
        forceRefresh: function(){
            clearVisibilityCache();
        },

        // Создать PositionController
        createController: function(){
            return new PositionController();
        },

        // Получить размеры сцены
        getStageSize: getStageSize
    };

    // Экспорт
    if(typeof module !== "undefined" && module.exports){
        module.exports = HudPositioning;
    } else {
        Packages.modengine = Packages.modengine || {};
        Packages.modengine.HudPositioning = HudPositioning;
    }
})();
