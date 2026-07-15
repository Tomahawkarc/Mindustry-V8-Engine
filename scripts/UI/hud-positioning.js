/**
 * - Автоматическое обнаружение сторонних HUD элементов
 * - Позиционирование СТРОГО под другими модами (не поверх)
 * - Object pooling для минимизации GC и микро-фризов
 * - Адаптивный refresh rate в зависимости от активности
 * - Поддержка мобильных и десктопных раскладок
 */

(function(){
    var Core = Packages.arc.Core;
    var Vec2 = Packages.arc.math.geom.Vec2;
    var Table = Packages.arc.scene.ui.layout.Table;
    var Group = Packages.arc.scene.Group;
    var Touchable = Packages.arc.scene.event.Touchable;
    var Vars = Packages.mindustry.Vars;
    var Log = Packages.arc.util.Log;
    var Time = Packages.arc.util.Time;

    // OBJECT POOLING - предотвращение GC и микро-фризов
    
    var vec2Pool = [];
    var vec2PoolSize = 0;
    var POOL_MAX_SIZE = 32;

    function obtainVec2(x, y){
        if(vec2PoolSize > 0){
            vec2PoolSize--;
            var v = vec2Pool[vec2PoolSize];
            vec2Pool[vec2PoolSize] = null;
            if(x !== undefined) v.x = x;
            if(y !== undefined) v.y = y;
            return v;
        }
        return new Vec2(x || 0, y || 0);
    }

    function freeVec2(v){
        if(v && vec2PoolSize < POOL_MAX_SIZE){
            vec2Pool[vec2PoolSize++] = v;
        }
    }

    // Переиспользуемые векторы для вычислений
    var sharedVec2A = new Vec2();
    var sharedVec2B = new Vec2();
    var sharedVec2C = new Vec2();

    // =============================================================================
    // HUD OBSTACLE DETECTION - обнаружение препятствий
    // =============================================================================

    var obstacleBuffer = [];
    var MAX_OBSTACLES = 50;
    var MAX_DEPTH = 12;

    // Кэш видимости элементов (предотвращает повторные проверки)
    var visibilityCache = {};
    var VISIBILITY_CACHE_MAX_AGE = 16; // кадров
    var cacheAge = 0;

    function clearVisibilityCache(){
        visibilityCache = {};
        cacheAge = 0;
    }

    function isEffectivelyVisible(element){
        if(element == null) return false;
        
        var id = String(element.hashCode ? element.hashCode() : element.toString());
        
        if(visibilityCache[id] !== undefined){
            if(cacheAge - visibilityCache[id].checked < VISIBILITY_CACHE_MAX_AGE){
                return visibilityCache[id].visible;
            }
        }

        var visible = true;
        try{
            var current = element;
            while(current != null){
                if(current.visible === false){
                    visible = false;
                    break;
                }
                if(current.alpha <= 0.01){
                    visible = false;
                    break;
                }
                current = current.getParent();
            }
        }catch(e){
            visible = false;
        }

        visibilityCache[id] = { visible: visible, checked: cacheAge };
        return visible;
    }

    function belongsToModEngine(element){
        if(element == null) return false;
        try{
            var name = element.name == null ? "" : String(element.name);
            return name.indexOf("mod-engine") === 0 || 
                   name.indexOf("nexus") === 0 ||
                   name.indexOf("modengine") === 0;
        }catch(e){
            return false;
        }
    }

    function isExternalHudElement(element){
        if(element == null) return false;
        if(belongsToModEngine(element)) return false;
        
        // Проверяем известные имена HUD элементов из других модов
        try{
            var name = element.name == null ? "" : String(element.name).toLowerCase();
            
            // Игнорируем системные элементы Mindustry
            if(name === "hudgroup" || name === "statustable" || 
               name === "mobile buttons" || name === "minimap" ||
               name === "chatfrag" || name === "blockinfo" ||
               name === "frag" || name === "table") {
                return false;
            }

            // Проверяем на наличие признаков HUD других модов
            var knownModPrefixes = [
                "ex", "enhanced", "extended", "additional", "extra",
                "custom", "modded", "community", "player", "quick",
                "fast", "auto", "smart", "advanced", "pro"
            ];

            for(var i = 0; i < knownModPrefixes.length; i++){
                if(name.indexOf(knownModPrefixes[i]) >= 0 && 
                   (name.indexOf("hud") >= 0 || name.indexOf("panel") >= 0 ||
                    name.indexOf("bar") >= 0 || name.indexOf("ui") >= 0)){
                    return true;
                }
            }

            // Элементы с тултипами в HUD зоне часто являются кнопками других модов
            if(element.getToolTip() != null && isEffectivelyVisible(element)){
                return true;
            }

        }catch(e){}

        return false;
    }

    /**
     * Собирает все препятствия (другие HUD элементы) в указанной области
     * @param {Group} root - корневой элемент для обхода (обычно Vars.ui.hudGroup)
     * @param {number} x - X координата области интереса
     * @param {number} width - ширина области интереса
     * @param {Array} out - массив для результатов [y1, y2, y3, y4, ...]
     * @param {number} depth - текущая глубина рекурсии
     */
    function collectObstacles(root, x, width, out, depth){
        if(root == null || depth > MAX_DEPTH || out.length >= MAX_OBSTACLES * 2){
            return;
        }

        cacheAge++;

        try{
            // Пропускаем элементы Mod Engine
            if(belongsToModEngine(root)){
                return;
            }

            // Проверяем видимость
            if(!isEffectivelyVisible(root)){
                return;
            }

            // Получаем позицию и размеры
            sharedVec2A.set(0, 0);
            root.localToStageCoordinates(sharedVec2A);
            
            var elemX = sharedVec2A.x;
            var elemY = sharedVec2A.y;
            var elemWidth = root.getWidth();
            var elemHeight = root.getHeight();

            // Быстрая проверка: элемент слишком далеко по горизонтали
            var horizontalOverlap = Math.min(x + width, elemX + elemWidth) - Math.max(x, elemX);
            
            if(horizontalOverlap >= 10){
                // Элемент пересекается по горизонтали - добавляем как препятствие
                out.push(elemY);           // bottom
                out.push(elemY + elemHeight); // top
            }

            // Рекурсивный обход детей
            if(root instanceof Group){
                var children = root.getChildren();
                if(children != null){
                    var count = Math.min(children.size, 100); // лимит детей
                    for(var i = 0; i < count; i++){
                        var child = children.items[i];
                        if(child != null){
                            collectObstacles(child, x, width, out, depth + 1);
                        }
                    }
                }
            }
        }catch(e){
            // Игнорируем ошибки при обходе
        }
    }

    // =============================================================================
    // SMART POSITIONING - умное позиционирование
    // =============================================================================

    /**
     * Находит лучшую Y-позицию для размещения HUD элемента
     * строго ПОД всеми другими элементами
     * 
     * @param {Table} anchor - якорный элемент (от которого начинаем)
     * @param {number} anchorY - Y-координата якоря
     * @param {number} x - X-координата размещаемого HUD
     * @param {number} width - ширина HUD
     * @param {number} height - высота HUD
     * @returns {number} Y-координата для размещения (bottom позиции)
     */
    function findBestYPosition(anchor, anchorY, x, width, height){
        obstacleBuffer.length = 0;
        
        // Собираем все препятствия в HUD группе
        if(Vars.ui != null && Vars.ui.hudGroup != null){
            collectObstacles(Vars.ui.hudGroup, x, width, obstacleBuffer, 0);
        }

        var obstacles = obstacleBuffer;
        var resultY = anchorY;
        var gap = 6; // пикселей зазора между элементами

        // Проходим по всем препятствиям и находим позицию ПОД ними
        for(var i = 0; i < obstacles.length; i += 2){
            var obsBottom = obstacles[i];
            var obsTop = obstacles[i + 1];

            // Если верх препятствия выше нашей текущей позиции
            // и препятствие достаточно близко по вертикали
            if(obsTop > resultY - gap && obsBottom < resultY + height + gap){
                // Размещаемся под этим препятствием
                var newY = obsBottom - gap;
                if(newY < resultY){
                    resultY = newY;
                }
            }
        }

        // Дополнительная защита от выхода за границы экрана
        var screenHeight = Core.scene.getHeight();
        var marginBottom = Core.scene.marginBottom || 0;
        var minY = marginBottom + 8;

        if(resultY - height < minY){
            // Если не помещаемся снизу, пробуем разместить в безопасной зоне
            resultY = Math.max(resultY, minY + height);
        }

        return resultY;
    }

    /**
     * Адаптивный контроллер обновления позиции
     * Уменьшает частоту обновлений когда HUD стабилен
     */
    function PositionController(){
        this.lastPosition = { x: 0, y: 0 };
        this.updateTimer = 0;
        this.quickUpdateCount = 0;
        this.isStable = false;
        this.anchor = null;
        this.holder = null;
    }

    PositionController.prototype = {
        reset: function(){
            this.updateTimer = 0;
            this.quickUpdateCount = 0;
            this.isStable = false;
        },

        getUpdateInterval: function(){
            // Быстрые обновления при изменении (первые 5 кадров)
            if(this.quickUpdateCount < 5){
                return 1; // каждый кадр
            }
            
            // После стабилизации - реже
            if(this.isStable){
                return 60; // раз в секунду
            }
            
            return 8; // раз в ~130мс
        },

        update: function(currentX, currentY){
            var dx = Math.abs(currentX - this.lastPosition.x);
            var dy = Math.abs(currentY - this.lastPosition.y);
            
            this.lastPosition.x = currentX;
            this.lastPosition.y = currentY;

            // Если позиция изменилась значительно - сбрасываем стабильность
            if(dx > 2 || dy > 2){
                this.isStable = false;
                this.quickUpdateCount = 0;
            } else {
                this.quickUpdateCount++;
                if(this.quickUpdateCount >= 10){
                    this.isStable = true;
                }
            }

            this.updateTimer++;
            return this.updateTimer >= this.getUpdateInterval();
        }
    };

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    var HudPositioning = {
        // Конструктор PositionController для внешнего использования
        PositionController: PositionController,

        // Создание оптимизированного HUD контейнера
        createHudContainer: function(name, touchable){
            var root = new Table();
            root.name = name || "mod-engine-hud";
            root.setFillParent(true);
            root.touchable = touchable || Touchable.childrenOnly;
            root.visible = true;
            return root;
        },

        // Позиционирование HUD элемента под другими модами
        positionUnderOthers: function(holder, anchor, preferredX, preferredY){
            if(holder == null) return;

            var x = preferredX !== undefined ? preferredX : holder.getX();
            var width = holder.getWidth();
            var height = holder.getHeight();

            // Находим лучшую позицию ПОД другими элементами
            var bestY = findBestYPosition(anchor, preferredY, x, width, height);

            holder.setPosition(x, bestY - height);
        },

        // Публичная функция для поиска лучшей Y позиции (используется в runtime.js)
        findBestYPosition: function(anchor, anchorY, x, width, height){
            return findBestYPosition(anchor, anchorY, x, width, height);
        },

        // Создание адаптивного update callback
        createUpdateCallback: function(holder, anchor, positionController){
            var controller = positionController || new PositionController();
            var point = obtainVec2();

            return function(){
                try{
                    if(holder == null || !holder.visible || anchor == null || !anchor.hasParent()){
                        return;
                    }

                    // Получаем текущую позицию якоря
                    point.set(0, 0);
                    anchor.localToStageCoordinates(point);

                    var currentX = point.x;
                    var currentY = point.y;

                    // Проверяем нужно ли обновлять позицию
                    if(controller.update(currentX, currentY)){
                        HudPositioning.positionUnderOthers(holder, anchor, currentX, currentY);
                    }

                }catch(e){
                    Log.err("HudPositioning update error", e);
                }
            };
        },

        // Очистка ресурсов
        dispose: function(){
            clearVisibilityCache();
            obstacleBuffer.length = 0;
            // Освобождаем векторы из пула
            for(var i = 0; i < vec2PoolSize; i++){
                freeVec2(vec2Pool[i]);
            }
        },

        // Принудительное обновление кэша видимости
        forceRefresh: function(){
            clearVisibilityCache();
        },

        // Утилита для обнаружения сторонних HUD элементов
        isExternalHudElement: function(element){
            return isExternalHudElement(element);
        },

        // Сброс кэша (полезно при переключении между модами)
        resetCache: function(){
            clearVisibilityCache();
            obstacleBuffer.length = 0;
        }
    };

    // Экспорт модуля
    if(typeof module !== "undefined" && module.exports){
        module.exports = HudPositioning;
    } else {
        // Для Rhino в Mindustry
        Packages.modengine = Packages.modengine || {};
        Packages.modengine.HudPositioning = HudPositioning;
    }

})();
