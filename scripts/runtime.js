(function(){
var Core = Packages.arc.Core;
var Color = Packages.arc.graphics.Color;
var Draw = Packages.arc.graphics.g2d.Draw;
var Fill = Packages.arc.graphics.g2d.Fill;
var Lines = Packages.arc.graphics.g2d.Lines;
var Log = Packages.arc.util.Log;
var Time = Packages.arc.util.Time;
var Mathf = Packages.arc.math.Mathf;

var BaseDrawable = Packages.arc.scene.style.BaseDrawable;
var Group = Packages.arc.scene.Group;
var Table = Packages.arc.scene.ui.layout.Table;
var Button = Packages.arc.scene.ui.Button;
var TextButton = Packages.arc.scene.ui.TextButton;
var ImageButton = Packages.arc.scene.ui.ImageButton;
var InputListener = Packages.arc.scene.event.InputListener;
var Touchable = Packages.arc.scene.event.Touchable;

var Vars = Packages.mindustry.Vars;
var Styles = Packages.mindustry.ui.Styles;
var Fonts = Packages.mindustry.ui.Fonts;
var Pal = Packages.mindustry.graphics.Pal;
var Layer = Packages.mindustry.graphics.Layer;
var Icon = Packages.mindustry.gen.Icon;
var Groups = Packages.mindustry.gen.Groups;
var Team = Packages.mindustry.game.Team;
var StatusEffects = Packages.mindustry.content.StatusEffects;
var Weathers = Packages.mindustry.content.Weathers;
var Weather = Packages.mindustry.type.Weather;
var Turret = Packages.mindustry.world.blocks.defense.turrets.Turret;
var CoreBlock = Packages.mindustry.world.blocks.storage.CoreBlock;
var Wall = Packages.mindustry.world.blocks.defense.Wall;
var ItemTurret = Packages.mindustry.world.blocks.defense.turrets.ItemTurret;
var Conveyor = Packages.mindustry.world.blocks.distribution.Conveyor;
var ItemBridge = Packages.mindustry.world.blocks.distribution.ItemBridge;
var BufferedItemBridge = Packages.mindustry.world.blocks.distribution.BufferedItemBridge;
var Router = Packages.mindustry.world.blocks.distribution.Router;
var Junction = Packages.mindustry.world.blocks.distribution.Junction;
var BufferItem = Packages.mindustry.world.blocks.distribution.BufferItem;
var Geometry = Packages.arc.math.geom.Geometry;
var LogicAI = Packages.mindustry.ai.types.LogicAI;
var CommandAI = Packages.mindustry.ai.types.CommandAI;
var UnitCommand = Packages.mindustry.ai.UnitCommand;
var Vec2 = Packages.arc.math.geom.Vec2;
var IntSeq = Packages.arc.struct.IntSeq;
var Call = Packages.mindustry.gen.Call;
var ContentType = Packages.mindustry.ctype.ContentType;

var Trigger = Packages.mindustry.game.EventType.Trigger;
var ClientLoadEvent = Packages.mindustry.game.EventType.ClientLoadEvent;
var WorldLoadEvent = Packages.mindustry.game.EventType.WorldLoadEvent;
var TapEvent = Packages.mindustry.game.EventType.TapEvent;

var UserWorkbench = require("user-workbench");
var ModEngineRender = require("render");
var NexusSlider = require("UI/slider");

function scriptsApi(){
    try{ return Vars.mods == null ? null : Vars.mods.getScripts(); }catch(e){ return null; }
}

    function enemyTeam(){
    try{
        if(Vars.state != null && Vars.state.rules != null && Vars.state.rules.waveTeam != null) return Vars.state.rules.waveTeam;
    }catch(e){}
    try{ return Packages.mindustry.game.Team.crux; }catch(e2){ return Team.crux; }
}

function playerCore(){
    try{ return Vars.player == null ? null : Vars.player.closestCore(); }catch(e){ return null; }
}

function findOreTile(unit, item){
    if(unit == null || item == null) return null;
    try{
        if(Vars.indexer != null) return Vars.indexer.findClosestOre(unit.x, unit.y, item);
    }catch(e){}
    return null;
}

function ensureCommandController(unit){
    if(unit == null) return null;
    var ai = null;
    try{
        var current = unit.controller();
        if(current instanceof CommandAI){
            ai = current;
        }
    }catch(eGet){}
    if(ai == null){
        try{
            ai = new CommandAI();
            unit.controller(ai);
        }catch(eSet){
            return null;
        }
    }
    return ai;
}

function callCommandMethod(ai, unit, cmd){
    try{
        // Как в UnitType.create(): command.command = defaultCommand — прямое присваивание полю,
        // а не вызов метода. Это обходит конфликт поле/метод в Rhino полностью.
        if(unit.type == null || unit.type.commands == null || !unit.type.commands.contains(cmd)){
            return false;
        }
        ai.command = cmd;
        // Повторяем побочные эффекты метода CommandAI.command(), которые мы теряем,
        // не вызывая сам метод:
        unit.mineTile = null;
        try{ unit.clearBuilding(); }catch(eCb){}
        return true;
    }catch(e){
        Log.info("MOD_ENGINE_MINE_DEBUG: direct command assignment threw @", e);
        return false;
    }
}
function getItemStance(item){
    try{
        return Packages.mindustry.ai.ItemUnitStance.getByItem(item);
    }catch(e){
        return null;
    }
}

function unitHasMineCommand(unit){
    try{
        var curAi = unit.controller();
        return curAi instanceof CommandAI && curAi.command === UnitCommand.mineCommand;
    }catch(e){
        return false;
    }
}

// Включает/выключает конкретную руду в списке добычи юнита, НЕ сбрасывая уже
// идущий майнинг других выбранных руд (в отличие от setUnitMineTile, который
// заменяет цель целиком). Это и есть логика "несколько руд одновременно".
function toggleUnitMineItem(unit, item, enabled){
    if(unit == null || item == null) return false;

    var ai = ensureCommandController(unit);
    if(ai == null) return false;

    try{
        if(unit.type == null || unit.type.commands == null || !unit.type.commands.contains(UnitCommand.mineCommand)){
            return false;
        }
    }catch(eSupport){
        return false;
    }

    // Команду mineCommand выставляем только если она ещё не установлена —
    // иначе callCommandMethod() каждый раз обнуляет unit.mineTile и прерывает
    // уже идущий сбор других руд.
    if(!unitHasMineCommand(unit)){
        try{ callCommandMethod(ai, unit, UnitCommand.mineCommand); }catch(eCmd){ return false; }
    }

    var stance = getItemStance(item);
    if(stance == null) return false;

    try{
        if(enabled){
            ai.setStance(stance);
        }else{
            try{ ai.disableStance(stance); }catch(eDis){
                // fallback на случай другого имени метода в этой версии API
                try{ ai["disableStance"](stance); }catch(eDis2){}
            }
        }
    }catch(eStance){
        return false;
    }

    if(enabled){
        // fallback: если юнит ничем сейчас не занят, сразу подсказываем ближайшую руду,
        // чтобы не ждать следующего внутреннего тика MinerAI
        try{
            if(unitMineTile(unit) == null){
                var oreTile = findOreTile(unit, item);
                if(oreTile != null) unit.mineTile = oreTile;
            }
        }catch(eOre){}
    }

    return true;
}

function toggleFleetMiningItem(unitTypeName, item, enabled, team){
    var affected = 0;
    eachFleetUnit(unitTypeName, team, function(unit){
        if(toggleUnitMineItem(unit, item, enabled)) affected++;
    });
    return affected;
}

function setUnitMineTile(unit, item, preserveController){
    if(unit == null) return false;
    if(preserveController){
        // player-driven unit: PlayerController already handles native mine-and-return behavior,
        // just set the field directly and never touch the controller.
        try{
            if(item != null){
                var tile = findOreTile(unit, item);
                if(tile == null) return false;
                var canMineHere = true;
                try{ canMineHere = unit.canMine(); }catch(eCan){}
                if(!canMineHere) return false;
                unit.mineTile = tile;
                return true;
            }else{
                unit.mineTile = null;
                return true;
            }
        }catch(e){
            return false;
        }
    }

    var ai = ensureCommandController(unit);
    if(ai == null) return false;

    if(item == null){
        try{ callCommandMethod(ai, unit, UnitCommand.moveCommand); }catch(eClearCmd){}
        try{ unit.mineTile = null; }catch(eClearTile){}
        return true;
    }

    try{
        var canMineHere = true;
        try{ canMineHere = unit.canMine(item); }catch(eCan){ try{ canMineHere = unit.canMine(); }catch(eCan2){} }
        if(!canMineHere) return false;
    }catch(eValid){}

    try{
        if(unit.type == null || unit.type.commands == null || !unit.type.commands.contains(UnitCommand.mineCommand)){
            Log.info("MOD_ENGINE_MINE_DEBUG: unit @ type @ does NOT support mineCommand", unit.id, unit.type == null ? "null" : unit.type.name);
            return false;
        }
    }catch(eSupport){
        Log.info("MOD_ENGINE_MINE_DEBUG: commands check threw @", eSupport);
    }

    try{
        var commandOk = callCommandMethod(ai, unit, UnitCommand.mineCommand);
        Log.info("MOD_ENGINE_MINE_DEBUG: direct command assign ok=@, ai.command == @", commandOk, ai.command);

        var stance = getItemStance(item);
        Log.info("MOD_ENGINE_MINE_DEBUG: stance for item @ = @", item.name, stance);
        if(stance != null){
            ai.setStance(stance);
            Log.info("MOD_ENGINE_MINE_DEBUG: hasStance after set = @", ai.hasStance(stance));
        }

        // Fallback: явно ищем ближайшую руду и ставим mineTile напрямую,
        // на случай если внутренний MinerAI-делегат не начинает поиск сразу же в этот тик.
        try{
            var oreTile = findOreTile(unit, item);
            Log.info("MOD_ENGINE_MINE_DEBUG: findOreTile result = @", oreTile);
            if(oreTile != null){
                unit.mineTile = oreTile;
            }
        }catch(eOre){
            Log.info("MOD_ENGINE_MINE_DEBUG: findOreTile threw @", eOre);
        }

        return true;
    }catch(eCmd){
        Log.info("MOD_ENGINE_MINE_DEBUG: command/stance threw @", eCmd);
        return false;
    }
}

function unitMineTile(unit){
    if(unit == null) return null;
    try{ return unit.mineTile; }catch(e){
        try{ return unit.mineTile(); }catch(e2){ return null; }
    }
}

function clearUnitMining(unit, preserveController){
    setUnitMineTile(unit, null, preserveController);
}

function commandUnitMine(unit, item, preserveController){
    if(unit == null) return false;
    if(item == null){
        clearUnitMining(unit, preserveController);
        return false;
    }
    return setUnitMineTile(unit, item, preserveController);
}

function unitCargoFull(unit){
    try{
        if(unit.stack == null || unit.type == null) return false;
        return unit.stack.amount >= unit.type.itemCapacity;
    }catch(e){
        return false;
    }
}

function unitCargoEmpty(unit){
    try{
        return !unit.hasItem();
    }catch(eHas){
        try{
            return unit.stack == null || unit.stack.amount <= 0;
        }catch(e){
            return true;
        }
    }
}

function closestCoreForUnit(unit){
    try{
        var team = null;
        try{ team = unit.team(); }catch(eT){ team = unit.team; }
        if(team == null) return null;
        return team.core();
    }catch(e){
        return null;
    }
}

function deliverCargoToCorePlayerSafe(unit){
    if(unit == null) return false;
    if(unitCargoEmpty(unit)) return false;
    var core = closestCoreForUnit(unit);
    if(core == null) return false;

    var range = 5.625 * 8;
    try{ range = 5.625 * 8 + (core.block != null ? core.block.size * 8 / 2 : 0); }catch(eRange){}

    var within = false;
    try{ within = unit.within(core, range); }catch(eWithin){
        try{
            var dx = unit.x - core.x, dy = unit.y - core.y;
            within = (dx * dx + dy * dy) <= range * range;
        }catch(eWithin2){}
    }
    if(!within) return false;

    try{
        var item = unit.stack.item;
        var amount = unit.stack.amount;
        var accepted = amount;
        try{
            var unitTeamRef = null;
            try{ unitTeamRef = unit.team(); }catch(eUT){ unitTeamRef = unit.team; }
            accepted = Math.min(amount, core.acceptStack(item, amount, unitTeamRef));
        }catch(eAccept){}
        if(accepted > 0){
            Call.transferItemTo(unit, item, accepted, unit.x, unit.y, core);
        }
    }catch(eTransfer){}
    return true;
}

function canUnitMine(unit){
    try{
        if(unit == null || unit.type == null) return false;
        if(unit.type.mineTier >= 0 && unit.type.mineSpeed > 0) return true;
    }catch(e){}
    try{
        if(unit.type.commands != null && unit.type.commands.contains(UnitCommand.mineCommand)) return true;
    }catch(e2){}
    return false;
}

function unitTeamOf(unit){
    try{ return unit.team(); }catch(e){
        try{ return unit.team; }catch(e2){ return null; }
    }
}

function eachFleetUnit(unitTypeName, team, fn){
    if(unitTypeName == null || fn == null) return;
    var seen = {};
    function consider(unit){
        try{
            if(unit == null || unit.type == null) return;
            if(String(unit.type.name) !== String(unitTypeName)) return;
            if(team != null){
                var ut = unitTeamOf(unit);
                if(ut != null && ut != team) return;
            }
            if(!canUnitMine(unit)) return;
            var id = null;
            try{ id = unit.id; }catch(eId){ id = unit; }
            if(seen[id]) return;
            seen[id] = true;
            fn(unit);
        }catch(eInner){}
    }

    // Preferred: team unit index
    try{
        if(team != null){
            var data = team.data();
            if(data != null && data.units != null){
                var list = data.units;
                for(var i = 0; i < list.size; i++){
                    consider(list.items[i]);
                }
            }
        }
    }catch(e){}

    // Desktop/V8 fallback: Groups.unit is often more complete than team.data().units
    try{
        Groups.unit.each(cons(function(unit){
            consider(unit);
        }));
    }catch(eGroups){}
}

function assignFleetMining(unitTypeName, item, team){
    var assigned = 0;
    eachFleetUnit(unitTypeName, team, function(unit){
        if(commandUnitMine(unit, item)) assigned++;
    });
    return assigned;
}

function clearFleetMining(unitTypeName, team){
    eachFleetUnit(unitTypeName, team, function(unit){
        clearUnitMining(unit);
    });
}

function countFleetUnits(unitTypeName, team){
    var total = 0;
    eachFleetUnit(unitTypeName, team, function(unit){ total++; });
    return total;
}

function countFleetActive(unitTypeName, team){
    var total = 0;
    eachFleetUnit(unitTypeName, team, function(unit){
        var active = false;
        try{ active = unit.mining(); }catch(e){ try{ active = unitMineTile(unit) != null; }catch(e2){} }
        if(active) total++;
    });
    return total;
}

var ModEngineRuntime = (function(){
    var timeSpeed = 1;

    function applyGameSpeed(mult){
        timeSpeed = Math.max(1, mult == null ? 1 : mult);
        try{
            Time.setDeltaProvider(new JavaAdapter(Packages.arc.func.Floatp, {
                get: function(){
                    return Math.min(Core.graphics.getDeltaTime() * 60 * timeSpeed, 60 * timeSpeed);
                }
            }));
        }catch(e){
            Log.err("Failed to apply game speed", e);
        }
    }

    var ui = null;
    var hudRoot = null;
    var hudButton = null;
    var quickHudRoot = null;
    var quickHudButton = null;
    var quickHudAnchor = null;
    var speedHudRoot = null;
    var speedHudAnchor = null;
    var originalsCaptured = false;
    var turretDefaults = [];
    var weaponDefaults = [];
    var playerDefaults = null;
    var fleetAssignments = {};
    var markerLastTapMillis = 0;
    var markerLastTileX = -99999;
    var markerLastTileY = -99999;
    var worldWindStrength = 4.2;
    var originalWeatherEntries = [];
    var buildSelectionDragging = false;
    var buildSelectionArmMillis = 0;
    var buildSelectionInputLayer = null;
    var selectedBuilds = [];

    var theme = {
        panel: Color.valueOf("121922"),
        panel2: Color.valueOf("171e28"),
        panel3: Color.valueOf("202833"),
        line: Color.valueOf("2c3542"),
        gold: Color.valueOf("ffd28a"),
        goldDark: Color.valueOf("4a3924"),
        cyan: Color.valueOf("10e5e5"),
        cyanDark: Color.valueOf("06383d"),
        text: Color.valueOf("d8dde7"),
        muted: Color.valueOf("a99f91"),
        red: Color.valueOf("ffb3ae"),
        redDark: Color.valueOf("401019"),
        green: Color.valueOf("31d17a"),
        black: Color.valueOf("05090f")
    };

    function inGame(){
        try{
            return Vars.state != null && Vars.state.isGame();
        }catch(e){
            try{
                return Vars.state != null && !Vars.state.isMenu();
            }catch(e2){
                return false;
            }
        }
    }

    function player(){
        try{ return Vars.player; }catch(e){ return null; }
    }

    function playerUnit(){
        try{
            return Vars.player == null ? null : Vars.player.unit();
        }catch(e){
            return null;
        }
    }

    function playerTeam(){
        try{
            return Vars.player == null ? Team.sharded : Vars.player.team();
        }catch(e){
            return Team.sharded;
        }
    }

    function notify(text){
        try{
            Vars.ui.showInfoToast(String(text), 3);
        }catch(e){
            Log.info(String(text));
        }
    }

    function appendConsole(line){
        if(ui == null || ui.state == null) return;
        if(ui.state.consoleLines == null) ui.state.consoleLines = [];
        var text = String(line == null ? "null" : line).replace(/\r/g, "");
        var parts = text.split("\n");
        var stamp = "T+" + Math.floor(Time.time / 60) + "s";
        for(var i = 0; i < parts.length; i++){
            ui.state.consoleLines.push("[" + stamp + "] " + parts[i]);
        }
        while(ui.state.consoleLines.length > 200){
            ui.state.consoleLines.shift();
        }
        ui.state.consoleScrollBottom = true;
    }

    function refreshConsole(){
        try{ if(ui != null && ui.state != null && ui.state.tab === "console") ui.rebuild(); }catch(e){}
    }

    function formatConsoleResult(value){
        if(value == null) return "null";
        try{
            if(typeof value === "string") return value;
            if(typeof value === "number" || typeof value === "boolean") return String(value);
            if(value.getClass != null) return String(value) + "  <" + value.getClass().getSimpleName() + ">";
        }catch(e){}
        try{ return JSON.stringify(value, null, 2); }catch(eJson){}
        return String(value);
    }

    function createHudButton(){
        var icon = null;
        try{ icon = Icon.settings; }catch(eIcon){ try{ icon = Icon.menu; }catch(eMenu){} }
        var button = new ImageButton(icon, Styles.clearNonei);
        button.name = "mod-engine";
        try{ button.resizeImage(30); }catch(eResize){}
        button.clicked(run(function(){
            try{
                if(ui != null) ui.show();
            }catch(e){
                Log.err("Failed to open Mod Engine UI", e);
            }
        }));
        return button;
    }

    function attachHudButton(anchor, size){
        hudRoot = new Table();
        hudRoot.name = "mod-engine-root";
        hudRoot.setFillParent(true);
        hudRoot.touchable = Touchable.childrenOnly;

        var extension = new Table();
        extension.background(Styles.black6);
        extension.top().left();
        hudButton = createHudButton();
        extension.add(hudButton).size(size).tooltip("Mod Engine");
        extension.image().color(Pal.gray).width(4).fillY();
        extension.row();
        extension.image().color(Pal.gray).height(4).fillX().colspan(2);
        extension.pack();
        hudRoot.addChild(extension);

        var position = new Vec2();
        hudRoot.update(run(function(){
            try{
                var shown = inGame() && anchor != null && anchor.hasParent();
                hudRoot.visible = shown;
                if(!shown) return;
                position.set(0, 0);
                anchor.localToStageCoordinates(position);
                extension.pack();
                extension.setPosition(position.x + anchor.getWidth(), position.y + anchor.getHeight() - extension.getHeight());
            }catch(ePosition){}
        }));
        Vars.ui.hudGroup.addChild(hudRoot);
    }

    function ensureHudButton(){
        if(ui == null) return;
        if(Vars.ui == null || Vars.ui.hudGroup == null) return;
        try{
            var existing = Vars.ui.hudGroup.find("mod-engine");
            if(existing != null && existing.hasParent()){
                hudButton = existing;
                return;
            }
        }catch(eExisting){}

        // Attach visually after the native row without changing its hardcoded five-button width.
        try{
            var nativeRow = Vars.ui.hudGroup.find("mobile buttons");
            if(nativeRow != null){
                attachHudButton(nativeRow, 65);
                return;
            }
        }catch(eNative){}

        // Desktop has no button row; attach to the status table without affecting its layout.
        try{
            var statusTable = Vars.ui.hudGroup.find("statustable");
            if(statusTable != null){
                attachHudButton(statusTable, 52);
                return;
            }
        }catch(eStatus){}

        if(hudRoot != null){
            try{ if(hudRoot.hasParent()) return; }catch(eParent){}
        }
        hudRoot = new Table();
        hudRoot.name = "mod-engine-fallback";
        hudRoot.setFillParent(true);
        hudRoot.top().left();
        hudRoot.touchable = Touchable.childrenOnly;
        var holder = new Table();
        holder.left().top();
        holder.marginTop(8);
        holder.marginLeft(340);
        hudButton = createHudButton();
        holder.add(hudButton).size(52).tooltip("Mod Engine");
        hudRoot.add(holder).left().top();
        hudRoot.update(run(function(){
            try{ hudRoot.visible = inGame(); }catch(eVisible){}
        }));
        Vars.ui.hudGroup.addChild(hudRoot);
    }

    function findCommandHudButton(element){
        if(element == null) return null;
        try{
            if(element instanceof TextButton){
                var expected = String(Core.bundle.get("command"));
                var text = String(element.getText());
                if(text === expected) return element;
            }
        }catch(eText){}
        try{
            if(element instanceof Group){
                var children = element.getChildren();
                for(var i = 0; i < children.size; i++){
                    var found = findCommandHudButton(children.items[i]);
                    if(found != null) return found;
                }
            }
        }catch(eChildren){}
        return null;
    }

    function removeQuickHud(){
        try{ if(quickHudRoot != null) quickHudRoot.remove(); }catch(eRemove){}
        quickHudRoot = null;
        quickHudButton = null;
        quickHudAnchor = null;
    }

    function ensureQuickSelectionButton(){
        if(ui == null || ui.state == null || Vars.ui == null || Vars.ui.hudGroup == null) return;
        if(!ui.state.quickSelectionEnabled){
            removeQuickHud();
            return;
        }
        try{ if(quickHudRoot != null && quickHudRoot.hasParent()) return; }catch(eParent){}

        quickHudAnchor = findCommandHudButton(Vars.ui.hudGroup);
        quickHudRoot = new Table();
        quickHudRoot.name = "mod-engine-selection-root";
        quickHudRoot.setFillParent(true);
        quickHudRoot.touchable = Touchable.childrenOnly;
        var holder = new Table();
        quickHudButton = new Button(Styles.clearNonei);
        quickHudButton.name = "mod-engine-selection";
        quickHudButton.left();
        quickHudButton.image(Icon.wrench).size(26).padLeft(10).padRight(8);
        quickHudButton.add("SELECT").left().growX().padRight(10);
        quickHudButton.clicked(run(function(){
            if(ui != null && ui.state != null){
                beginBuildSelection();
            }
        }));
        holder.add(quickHudButton).size(155, 48).tooltip("Select structures: " + String(ui.state.buildSelectionFilter || "all"));
        holder.pack();
        quickHudRoot.addChild(holder);
        var pos = new Vec2();
        quickHudRoot.update(run(function(){
            try{
                var enabled = inGame() && ui != null && ui.state != null && ui.state.quickSelectionEnabled;
                quickHudRoot.visible = enabled;
                if(!enabled) return;
                if(quickHudAnchor == null || !quickHudAnchor.hasParent()) quickHudAnchor = findCommandHudButton(Vars.ui.hudGroup);
                if(quickHudAnchor != null){
                    pos.set(0, 0);
                    quickHudAnchor.localToStageCoordinates(pos);
                    var targetX = pos.x + quickHudAnchor.getWidth();
                    var stageWidth = 0;
                    try{ stageWidth = Core.scene.getWidth(); }catch(eStage){ stageWidth = Core.graphics.getWidth(); }
                    var maxX = Math.max(0, stageWidth - holder.getWidth() - Core.scene.marginRight);
                    holder.setPosition(Math.min(targetX, maxX), pos.y);
                    holder.visible = quickHudAnchor.visible;
                }else{
                    holder.setPosition(163 + Core.scene.marginLeft, 8 + Core.scene.marginBottom);
                    holder.visible = true;
                }
            }catch(ePosition){}
        }));
        Vars.ui.hudGroup.addChild(quickHudRoot);
    }

    function removeSpeedHud(){
        try{ if(speedHudRoot != null) speedHudRoot.remove(); }catch(eRemove){}
        speedHudRoot = null;
        speedHudAnchor = null;
    }

    function ensureSpeedHud(){
        if(Vars.ui == null || Vars.ui.hudGroup == null) return;
        if(ui == null || ui.state == null || !ui.state.worldSpeedQuickAccess){
            removeSpeedHud();
            return;
        }
        try{ if(speedHudRoot != null && speedHudRoot.hasParent()) return; }catch(eParent){}

        speedHudRoot = new Table();
        speedHudRoot.name = "mod-engine-speed-root";
        speedHudRoot.setFillParent(true);
        speedHudRoot.touchable = Touchable.childrenOnly;
        var holder = new Table();
        holder.name = "mod-engine-speed";
        holder.background(Styles.black6);
        holder.margin(6);
        holder.image(Icon.play).size(20).padRight(6);
        var speedLabel = new Packages.arc.scene.ui.Label("x" + Math.round(timeSpeed), Styles.outlineLabel);
        speedLabel.setFontScale(0.72);
        speedLabel.setAlignment(Packages.arc.util.Align.center);

        var slider = NexusSlider.createNexusSlider(1, 16, 1, timeSpeed, function(value){
            var next = Math.max(1, Math.round(value));
            applyGameSpeed(next);
            if(ui != null && ui.state != null) ui.state.simSpeed = next;
            speedLabel.setText("x" + next);
        }, {track: theme.lineSoft, trackHighlight: theme.line, fill: theme.gold, handle: theme.gold, glow: theme.gold});
        holder.add(slider.element).width(230).height(28).padRight(7);
        holder.add(speedLabel).width(38);
        holder.button("x1", Styles.cleart, run(function(){
            slider.setValue(1, true);
        })).size(42, 30).padLeft(4);
        holder.pack();
        speedHudRoot.addChild(holder);

        speedHudRoot.update(run(function(){
            try{
                speedHudRoot.visible = inGame() && Vars.ui.hudfrag.shown && ui != null && ui.state != null && ui.state.worldSpeedQuickAccess;
                if(!speedHudRoot.visible) return;
                if(speedHudAnchor == null || !speedHudAnchor.hasParent()) speedHudAnchor = Vars.ui.hudGroup.find("statustable");
                if(speedHudAnchor != null){
                    var p = new Vec2();
                    p.set(0, 0);
                    speedHudAnchor.localToStageCoordinates(p);
                    holder.setPosition(p.x, p.y - holder.getHeight() - 4);
                }else{
                    holder.setPosition(Core.scene.marginLeft + 8, Core.scene.getHeight() - Core.scene.marginTop - holder.getHeight() - 84);
                }
            }catch(ePosition){}
        }));
        Vars.ui.hudGroup.addChild(speedHudRoot);
    }

    function eachCore(team, fn){
        if(team == null || fn == null) return;
        try{
            team.cores().each(cons(function(core){
                fn(core);
            }));
        }catch(e){}
    }

    function firstPlayerCore(){
        var team = playerTeam();
        if(team == null) return null;
        try{
            var cores = team.cores();
            return (cores != null && cores.size > 0) ? cores.first() : null;
        }catch(e){
            return null;
        }
    }

    function addItemToCore(item, amount){
        if(item == null || amount == null) return;
        var core = firstPlayerCore();
        if(core == null) return;
        try{ core.items.add(item, amount); }catch(e){}
    }

    function clearCoreItems(){
        var core = firstPlayerCore();
        if(core == null) return;
        try{
            Vars.content.items().each(cons(function(item){
                try{ core.items.remove(item, core.items.get(item)); }catch(eItem){}
            }));
        }catch(e){}
    }

    function fillAllItems(){
        var core = firstPlayerCore();
        if(core == null) return;
        try{
            var capacity = 0;
            try{ capacity = Math.max(0, Math.floor(core.storageCapacity)); }catch(eCapacity){}
            if(capacity <= 0){
                try{ capacity = Math.max(0, Math.floor(core.block.itemCapacity)); }catch(eBlockCapacity){}
            }
            if(capacity <= 0) return;
            Vars.content.items().each(cons(function(item){
                try{
                    core.items.set(item, capacity);
                }catch(eItem){}
            }));
        }catch(e){}
    }

    function capturePlayerDefaults(){
        if(playerDefaults != null) return;
        var pu = playerUnit();
        if(pu == null || pu.type == null) return;
        playerDefaults = {
            health: pu.type.health,
            speed: pu.type.speed,
            mineSpeed: pu.type.mineSpeed
        };
    }

    function forEachTurret(fn){
        try{
            Vars.content.blocks().each(function(b){
                try{
                    if(b instanceof Turret) fn(b);
                }catch(e){}
            });
        }catch(e){}
    }

    function captureOriginals(){
        if(originalsCaptured) return;
        originalsCaptured = true;
        capturePlayerDefaults();

        try{
            Vars.content.blocks().each(cons(function(block){
                if(block instanceof Turret){
                    var ammoDefaults = [];
                    try{
                        if(block.ammoTypes == null){
                            if(block.name === "duo"){
                                Log.info("MOD_ENGINE_TURRET_DEBUG: duo.ammoTypes is NULL");
                            }
                        }else{
                            var keyCount = 0;
                            block.ammoTypes.each(function(item, bt){
                                keyCount++;
                                if(bt == null) return;
                                ammoDefaults.push({
                                    bullet: bt,
                                    range: bt.range,
                                    maxRange: bt.maxRange,
                                    lifetime: bt.lifetime,
                                    speed: bt.speed
                                });
                            });
                            if(block.name === "duo"){
                                Log.info("MOD_ENGINE_TURRET_DEBUG: duo.ammoTypes not null, keyCount=@, ammoDefaults.length=@", keyCount, ammoDefaults.length);
                            }
                        }
                    }catch(eAmmo){
                        Log.info("MOD_ENGINE_TURRET_DEBUG: ammo capture for block=@ threw @", block.name, eAmmo);
                    }
                    var weaponAmmoDefaults = [];
                    try{
                        if(block.weapons != null){
                            for(var wi = 0; wi < block.weapons.size; wi++){
                                var w = block.weapons.get(wi);
                                var wbt = w.bullet;
                                if(wbt == null) continue;
                                weaponAmmoDefaults.push({
                                    bullet: wbt,
                                    range: wbt.range,
                                    maxRange: wbt.maxRange,
                                    lifetime: wbt.lifetime,
                                    speed: wbt.speed
                                });
                            }
                        }
                    }catch(eWAmmo){
                        Log.info("MOD_ENGINE_TURRET_DEBUG: weapon-ammo capture for block=@ threw @", block.name, eWAmmo);
                    }
                    turretDefaults.push({
                        block: block,
                        reload: block.reload,
                        inaccuracy: block.inaccuracy,
                        range: block.range,
                        ammoDefaults: ammoDefaults,
                        weaponAmmoDefaults: weaponAmmoDefaults
                    });
                }
            }));
        }catch(e){
            Log.err("Failed to capture turret defaults", e);
        }

        try{
            Vars.content.units().each(cons(function(type){
                var index = 0;
                type.weapons.each(cons(function(weapon){
                    weaponDefaults.push({
                        weapon: weapon,
                        key: String(type.name) + ":" + index,
                        reload: weapon.reload,
                        inaccuracy: weapon.inaccuracy,
                        damage: weapon.bullet == null ? 0 : weapon.bullet.damage,
                        speed: weapon.bullet == null ? 0 : weapon.bullet.speed,
                        lifetime: weapon.bullet == null ? 0 : weapon.bullet.lifetime,
                        bulletRange: weapon.bullet == null ? 0 : weapon.bullet.range,
                        bulletMaxRange: weapon.bullet == null ? 0 : weapon.bullet.maxRange,
                        bulletLifetime: weapon.bullet == null ? 0 : weapon.bullet.lifetime,
                        bulletSpeed: weapon.bullet == null ? 0 : weapon.bullet.speed
                    });
                    index++;
                }));
            }));
        }catch(e2){
            Log.err("Failed to capture weapon defaults", e2);
        }
    }

    function resetTurrets(){
        for(var i = 0; i < turretDefaults.length; i++){
            var d = turretDefaults[i];
            try{
                d.block.reload = d.reload;
                d.block.inaccuracy = d.inaccuracy;
                d.block.range = d.range;
                for(var a = 0; a < d.ammoDefaults.length; a++){
                    var ad = d.ammoDefaults[a];
                    try{
                        ad.bullet.range = ad.range;
                        ad.bullet.maxRange = ad.maxRange;
                        ad.bullet.lifetime = ad.lifetime;
                        ad.bullet.speed = ad.speed;
                    }catch(eA){}
                }
                if(d.weaponAmmoDefaults != null){
                    for(var wa = 0; wa < d.weaponAmmoDefaults.length; wa++){
                        var wad = d.weaponAmmoDefaults[wa];
                        try{
                            wad.bullet.range = wad.range;
                            wad.bullet.maxRange = wad.maxRange;
                            wad.bullet.lifetime = wad.lifetime;
                            wad.bullet.speed = wad.speed;
                        }catch(eWA){}
                    }
                }
            }catch(e){}
        }
    }

    function buffTurrets(reloadMul, inaccuracy, rangeMul){
        captureOriginals();
        Log.info("MOD_ENGINE_TURRET_DEBUG: buffTurrets called, rangeMul=@ turretDefaults.length=@", rangeMul, turretDefaults.length);
        var loggedOnce = false;
        for(var i = 0; i < turretDefaults.length; i++){
            var d = turretDefaults[i];
            try{
                d.block.reload = Math.max(0, d.reload * reloadMul);
                d.block.inaccuracy = inaccuracy;
                var targetRange = d.range * rangeMul;
                d.block.range = targetRange;
                for(var a = 0; a < d.ammoDefaults.length; a++){
                    var ad = d.ammoDefaults[a];
                    try{
                        var beforeLifetime = ad.bullet.lifetime;
                        // Формула из проверенного рабочего кода: lifetime = targetRange / speed,
                        // maxRange = targetRange безусловно (не только когда maxRange > 0 изначально)
                        if(ad.bullet.speed > 0) ad.bullet.lifetime = targetRange / ad.bullet.speed;
                        ad.bullet.maxRange = targetRange;
                        if(!loggedOnce){
                            loggedOnce = true;
                            Log.info("MOD_ENGINE_TURRET_DEBUG: block=@ ammo lifetime before=@ saved_default=@ after=@ speed=@",
                                d.block.name, beforeLifetime, ad.lifetime, ad.bullet.lifetime, ad.bullet.speed);
                        }
                    }catch(eA){
                        Log.info("MOD_ENGINE_TURRET_DEBUG: ammo update threw @", eA);
                    }
                }
                if(d.ammoDefaults.length === 0 && (d.weaponAmmoDefaults == null || d.weaponAmmoDefaults.length === 0)){
                    Log.info("MOD_ENGINE_TURRET_DEBUG: block=@ has EMPTY ammoDefaults AND weaponAmmoDefaults (no bullet found at all!)", d.block.name);
                }

                if(d.weaponAmmoDefaults != null){
                    for(var wa = 0; wa < d.weaponAmmoDefaults.length; wa++){
                        var wad = d.weaponAmmoDefaults[wa];
                        try{
                            var wBefore = wad.bullet.lifetime;
                            if(wad.bullet.speed > 0) wad.bullet.lifetime = targetRange / wad.bullet.speed;
                            wad.bullet.maxRange = targetRange;
                            if(!loggedOnce){
                                loggedOnce = true;
                                Log.info("MOD_ENGINE_TURRET_DEBUG: (via weapons) block=@ lifetime before=@ saved_default=@ after=@ speed=@",
                                    d.block.name, wBefore, wad.lifetime, wad.bullet.lifetime, wad.bullet.speed);
                            }
                        }catch(eWA){
                            Log.info("MOD_ENGINE_TURRET_DEBUG: weapon-ammo update threw @", eWA);
                        }
                    }
                }
            }catch(e){
                Log.info("MOD_ENGINE_TURRET_DEBUG: block update threw @", e);
            }
        }
        if(!loggedOnce){
            Log.info("MOD_ENGINE_TURRET_DEBUG: WARNING - no ammo entries were ever processed across all @ turrets!", turretDefaults.length);
        }
    }

    function resetWeapons(){
        for(var i = 0; i < weaponDefaults.length; i++){
            var d = weaponDefaults[i];
            try{
                d.weapon.reload = d.reload;
                d.weapon.inaccuracy = d.inaccuracy;
                if(d.weapon.bullet != null){
                    d.weapon.bullet.damage = d.damage;
                    d.weapon.bullet.speed = d.speed;
                    d.weapon.bullet.lifetime = d.lifetime;
                }
            }catch(e){}
        }
    }

    function buffWeapons(){
        captureOriginals();
        for(var i = 0; i < weaponDefaults.length; i++){
            var d = weaponDefaults[i];
            try{
                d.weapon.reload = Math.max(1, d.reload * 0.48);
                d.weapon.inaccuracy = 0.5;
                if(d.weapon.bullet != null){
                    d.weapon.bullet.damage = Math.max(d.damage, 45);
                    if(d.weapon.bullet.speed > 0 && d.weapon.bullet.lifetime > 0){
                        d.weapon.bullet.lifetime = Math.max(d.lifetime, d.lifetime * 1.2);
                    }
                }
            }catch(e){}
        }
    }

    function applyTeamInstantReload(enabled){
        if(!enabled) return;
        var team = playerTeam();
        if(team == null) return;
        try{
            var data = team.data();
            if(data == null || data.units == null) return;
            var list = data.units;
            for(var i = 0; i < list.size; i++){
                try{
                    var unit = list.items[i];
                    if(unit == null) continue;
                    var mounts = null;
                    try{ mounts = unit.mounts(); }catch(eM){ try{ mounts = unit.mounts; }catch(eM2){} }
                    if(mounts == null) continue;
                    for(var m = 0; m < mounts.length; m++){
                        try{ mounts[m].reload = 0; }catch(eMount){}
                    }
                }catch(eInner){}
            }
        }catch(e){}
    }

    function eachWorldBuild(fn){
        if(fn == null || Vars.world == null || Vars.world.tiles == null) return;
        try{
            Vars.world.tiles.eachTile(cons(function(tile){
                try{
                    if(tile == null || tile.build == null || tile.build.tile != tile) return;
                    fn(tile.build);
                }catch(eTile){}
            }));
        }catch(e){}
    }

    function healAllStructures(){
        var healed = 0;
        eachWorldBuild(function(build){
            try{
                build.health = build.maxHealth;
                try{ build.healthChanged(); }catch(eChanged){}
                healed++;
            }catch(e){}
        });
        return healed;
    }

    function killUnits(filter){
        try{
            Groups.unit.each(cons(function(unit){
                try{
                    if(filter == null || filter(unit)) unit.kill();
                }catch(e){}
            }));
        }catch(e2){}
    }

    function killBuildings(filter){
        var targets = [];
        eachWorldBuild(function(build){
            try{ if(filter == null || filter(build)) targets.push(build); }catch(e){}
        });
        for(var i = 0; i < targets.length; i++){
            try{ if(targets[i] != null && targets[i].isValid()) targets[i].kill(); }catch(eKill){}
        }
    }

    function enemyFilterUnit(unit){
        try{
            return unit.team != playerTeam() && unit.team() != playerTeam();
        }catch(e){
            try{ return unit.team() != playerTeam(); }catch(e2){ return false; }
        }
    }

    function enemyFilterBuilding(build){
        try{
            var same = build.team == playerTeam() || build.team() == playerTeam();
            if(same) return false;
        }catch(e){}
        try{
            return !(build.block instanceof CoreBlock);
        }catch(e2){
            return true;
        }
    }

    function forceRules(){
        try{
            Vars.state.rules.waveSending = true;
            Vars.state.rules.waves = true;
        }catch(e){}
    }

    function applyPlayerStatus(command){
        var unit = playerUnit();
        if(unit == null) return;
        try{
            if(command === "player:status:overdrive" || command === "player:status:fast") unit.apply(StatusEffects.overclock, 60 * 20);
            if(command === "player:status:invincible"){
                unit.health = unit.maxHealth;
                try{ unit.shield = Math.max(unit.shield, 5000); }catch(e2){}
            }
            if(command === "player:status:burning") unit.apply(StatusEffects.burning, 60 * 10);
            if(command === "player:status:freezing") unit.apply(StatusEffects.freezing, 60 * 10);
            if(command === "player:status:shocked") unit.apply(StatusEffects.shocked, 60 * 10);
            if(command === "player:status:corroded") unit.apply(StatusEffects.corroded, 60 * 10);
            if(command === "player:status:cloaked") unit.apply(StatusEffects.unmoving, 60 * 8);
        }catch(e){
            notify("STATUS APPLY FAILED");
        }
    }

    function teamOf(unit){
        try{ return unit.team(); }catch(e){ try{ return unit.team; }catch(e2){ return playerTeam(); } }
    }

    function setUnitTeam(unit, team){
        try{ unit.team(team); return; }catch(e){}
        try{ unit.team = team; }catch(e2){}
    }

    function captureSectorForPlayer(){
        try{
            if(Vars.net != null && Vars.net.client()){
                notify("SECTOR CAPTURE IS HOST-ONLY");
                return;
            }
        }catch(eNet){}

        var target = playerTeam();
        if(target == null){
            notify("PLAYER TEAM UNAVAILABLE");
            return;
        }

        var positions = new IntSeq();
        eachWorldBuild(function(build){
            try{ if(build.team != target) positions.add(build.pos()); }catch(eBuild){}
        });

        function transferPositions(list){
            var changedNow = 0;
            var index = 0;
            while(index < list.size){
                var chunk = new IntSeq();
                var end = Math.min(list.size, index + 500);
                for(var i = index; i < end; i++) chunk.add(list.items[i]);
                try{
                    // Direct invocation guarantees that static, non-updating blocks (notably
                    // walls) leave waveTeam before SectorCaptureEvent cleanup is fired.
                    Packages.mindustry.world.Tile.setTeams(chunk.toArray(), target);
                    if(Vars.net != null && Vars.net.active()) Call.setTeams(chunk.toArray(), target);
                    changedNow += chunk.size;
                }catch(eChunk){
                    Log.err("Sector team transfer failed", eChunk);
                }
                index = end;
            }
            return changedNow;
        }

        var changed = transferPositions(positions);
        try{
            Groups.unit.each(cons(function(unit){
                try{ if(unit != null && teamOf(unit) != target) setUnitTeam(unit, target); }catch(eUnit){}
            }));
        }catch(eUnits){}

        // Verify from the tile grid, not Groups.build: static walls are not guaranteed to be
        // represented by update-oriented entity groups in every build/mod combination.
        var retry = new IntSeq();
        eachWorldBuild(function(build){
            try{ if(build.team != target) retry.add(build.pos()); }catch(eBuild){}
        });
        if(retry.size > 0) changed += transferPositions(retry);

        try{
            if(Vars.state.isCampaign() && Vars.state.hasSector()){
                // SectorCaptureEvent normally destroys waveTeam buildings. Redirect that
                // cleanup to an unused team, then restore the original rule immediately.
                var originalWaveTeam = Vars.state.rules.waveTeam;
                var guardTeam = null;
                try{
                    for(var tid = 254; tid >= 10; tid--){
                        var candidate = Team.get(tid);
                        if(candidate == null || candidate == target || candidate == originalWaveTeam || candidate == Team.derelict) continue;
                        var data = candidate.data();
                        if(data != null && data.buildings.size === 0 && data.units.size === 0 && data.cores.size === 0){ guardTeam = candidate; break; }
                    }
                }catch(eGuard){}
                if(guardTeam == null) guardTeam = Team.malis;
                Vars.state.rules.waveTeam = guardTeam;
                try{ Call.sectorCapture(); }finally{ Vars.state.rules.waveTeam = originalWaveTeam; }
            }
        }catch(eCapture){
            Log.err("Official sector capture failed", eCapture);
        }

        // A final pass handles blocks created by capture listeners/replacements.
        var finalRetry = new IntSeq();
        eachWorldBuild(function(build){
            try{ if(build.team != target) finalRetry.add(build.pos()); }catch(eBuild){}
        });
        if(finalRetry.size > 0) changed += transferPositions(finalRetry);
        var stubborn = 0;
        eachWorldBuild(function(build){
            try{
                if(build.team != target){
                    Packages.mindustry.world.Tile.setTeam(build, target);
                    stubborn++;
                }
            }catch(eBuild){}
        });
        changed += stubborn;
        eachWorldBuild(function(build){
            try{
                // Team overlays of cached/static blocks are baked into the block cache.
                // Rebuild both wall and minimap caches after the final verified team pass.
                build.recache();
                if(build.tile != null){
                    try{ build.tile.recache(); }catch(eTile){}
                    try{ build.tile.recacheWall(); }catch(eWall){}
                    try{ Vars.renderer.minimap.update(build.tile); }catch(eMap){}
                }
            }catch(eVisual){}
        });
        try{
            Vars.state.rules.waves = false;
            Vars.state.rules.waveTimer = false;
            Vars.state.rules.attackMode = false;
            Vars.state.rules.defaultTeam = target;
            Vars.state.gameOver = false;
            Vars.state.rules.enemyCoreBuildRadius = 0;
            Vars.state.rules.dropZoneRadius = 0;
            Vars.state.rules.placeRangeCheck = false;
            Vars.state.rules.polygonCoreProtection = false;
            for(var teamIndex = 0; teamIndex < Team.all.length; teamIndex++){
                try{
                    var teamRule = Vars.state.rules.teams.get(Team.all[teamIndex]);
                    teamRule.protectCores = false;
                    teamRule.checkPlacement = false;
                }catch(eTeamRule){}
            }
            try{ Vars.state.teams.updateTeamStats(); }catch(eStats){}
            syncRules();
        }catch(eRules){}
        notify("SECTOR CAPTURED: " + changed + " STRUCTURES TRANSFERRED");
    }

    function syncRules(){
        try{ Call.setRules(Vars.state.rules); }catch(eSync){}
    }

    function applyWorldTime(value){
        var hour = ((Number(value) % 24) + 24) % 24;
        var sun = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
        var darkness = 0.82 * (1 - sun);
        try{
            Vars.state.rules.lighting = darkness > 0.04;
            Vars.state.rules.ambientLight.set(0.22 + 0.78 * sun, 0.28 + 0.72 * sun, 0.42 + 0.58 * sun, darkness);
            syncRules();
            notify("TIME OF DAY: " + hour.toFixed(1));
        }catch(e){ notify("TIME CONTROL FAILED"); }
    }

    function clearActiveWeather(){
        try{
            var active = [];
            Groups.weather.each(cons(function(weather){ active.push(weather); }));
            for(var i = 0; i < active.length; i++){
                try{ active[i].remove(); }catch(eRemove){}
            }
        }catch(e){}
    }

    function snapshotWeatherRules(){
        originalWeatherEntries = [];
        try{
            Vars.state.rules.weather.each(cons(function(entry){
                try{
                    originalWeatherEntries.push({
                        weather: entry.weather,
                        minFrequency: entry.minFrequency,
                        maxFrequency: entry.maxFrequency,
                        minDuration: entry.minDuration,
                        maxDuration: entry.maxDuration,
                        cooldown: entry.cooldown,
                        intensity: entry.intensity,
                        always: entry.always
                    });
                }catch(eEntry){}
            }));
        }catch(e){}
    }

    function resetWeatherRules(){
        clearActiveWeather();
        try{
            Vars.state.rules.weather.clear();
            for(var i = 0; i < originalWeatherEntries.length; i++){
                var source = originalWeatherEntries[i];
                var entry = new Packages.mindustry.type.Weather.WeatherEntry();
                entry.weather = source.weather;
                entry.minFrequency = source.minFrequency;
                entry.maxFrequency = source.maxFrequency;
                entry.minDuration = source.minDuration;
                entry.maxDuration = source.maxDuration;
                entry.cooldown = source.cooldown;
                entry.intensity = source.intensity;
                entry.always = source.always;
                Vars.state.rules.weather.add(entry);
                if(entry.always && entry.weather != null){
                    Weather.createWeather(entry.weather, entry.intensity, Math.max(60, entry.maxDuration), worldWindStrength, 0);
                }
            }
            syncRules();
            notify("WEATHER PROFILE RESET");
        }catch(e){
            Log.err("Weather reset failed", e);
            notify("WEATHER RESET FAILED");
        }
    }

    function updateWeatherWind(){
        try{
            Groups.weather.each(cons(function(state){
                try{
                    var wind = state.windVector();
                    if(wind != null){
                        var angle = wind.len2() > 0.0001 ? wind.angle() : 20;
                        wind.trns(angle, worldWindStrength);
                    }
                }catch(eWind){
                    try{ state.windVector.trns(20, worldWindStrength); }catch(eField){}
                }
            }));
        }catch(e){}
    }

    function beginBuildSelection(){
        if(ui == null || ui.state == null) return;
        ui.state.buildSelectionActive = true;
        ui.state.buildSelectionDragging = false;
        buildSelectionDragging = false;
        buildSelectionArmMillis = Time.millis() + 20;
        selectedBuilds = [];
        try{ ui.hide(); }catch(eHide){}
        try{ if(buildSelectionInputLayer != null) buildSelectionInputLayer.remove(); }catch(eOldLayer){}
        buildSelectionInputLayer = new Table();
        buildSelectionInputLayer.name = "mod-engine-build-selection-input";
        buildSelectionInputLayer.setFillParent(true);
        buildSelectionInputLayer.touchable = Touchable.enabled;
        buildSelectionInputLayer.addListener(extend(InputListener, {
            touchDown: function(event, x, y, pointer, button){
                if(pointer !== 0) return false;
                if(Time.millis() < buildSelectionArmMillis){
                    try{ event.stop(); }catch(eStop){}
                    return true;
                }
                var start = Core.input.mouseWorld();
                ui.state.buildSelectionStartX = start.x;
                ui.state.buildSelectionStartY = start.y;
                ui.state.buildSelectionEndX = start.x;
                ui.state.buildSelectionEndY = start.y;
                ui.state.buildSelectionDragging = true;
                buildSelectionDragging = true;
                try{ event.stop(); }catch(eStop){}
                return true;
            },
            touchDragged: function(event, x, y, pointer){
                if(!buildSelectionDragging) return;
                var current = Core.input.mouseWorld();
                ui.state.buildSelectionEndX = current.x;
                ui.state.buildSelectionEndY = current.y;
                try{ event.stop(); }catch(eStop){}
            },
            touchUp: function(event, x, y, pointer, button){
                if(!buildSelectionDragging) return;
                var end = Core.input.mouseWorld();
                ui.state.buildSelectionEndX = end.x;
                ui.state.buildSelectionEndY = end.y;
                buildSelectionDragging = false;
                ui.state.buildSelectionDragging = false;
                ui.state.buildSelectionActive = false;
                collectSelectedBuilds();
                try{ buildSelectionInputLayer.remove(); }catch(eRemove){}
                buildSelectionInputLayer = null;
                try{ event.stop(); }catch(eStop){}
                Core.app.post(run(function(){
                    try{ ui.showBuildSelection(selectedBuilds); }catch(eDialog){ Log.err("Build selection dialog failed", eDialog); }
                }));
            }
        }));
        Vars.ui.hudGroup.addChild(buildSelectionInputLayer);
        buildSelectionInputLayer.toFront();
        notify("DRAG OVER STRUCTURES TO SELECT");
    }

    function matchesBuildSelectionFilter(build, filter){
        if(build == null || build.block == null) return false;
        if(filter == null || filter === "all") return true;
        var block = build.block;
        var className = "";
        var name = "";
        try{ className = String(block.getClass().getSimpleName()).toLowerCase(); }catch(eClass){}
        try{ name = String(block.name).toLowerCase(); }catch(eName){}
        if(filter === "walls") return block instanceof Wall || className.indexOf("wall") >= 0;
        if(filter === "turrets") return block instanceof Turret || className.indexOf("turret") >= 0;
        if(filter === "bridges") return className.indexOf("bridge") >= 0 || name.indexOf("bridge") >= 0;
        if(filter === "conveyors"){
            return className.indexOf("conveyor") >= 0 || className.indexOf("duct") >= 0 ||
                className.indexOf("router") >= 0 || className.indexOf("junction") >= 0 ||
                className.indexOf("overflow") >= 0 || className.indexOf("underflow") >= 0;
        }
        if(filter === "pipelines"){
            return className.indexOf("conduit") >= 0 || className.indexOf("liquidrouter") >= 0 ||
                className.indexOf("liquidjunction") >= 0 || name.indexOf("conduit") >= 0 ||
                name.indexOf("pipe") >= 0;
        }
        if(filter === "factories"){
            return className.indexOf("crafter") >= 0 || className.indexOf("factory") >= 0 ||
                className.indexOf("reconstructor") >= 0 || className.indexOf("assembler") >= 0 ||
                className.indexOf("constructor") >= 0 || className.indexOf("separator") >= 0;
        }
        if(filter === "mining"){
            return className.indexOf("drill") >= 0 || className.indexOf("pump") >= 0 ||
                className.indexOf("fracker") >= 0 || className.indexOf("cultivator") >= 0 ||
                className.indexOf("extractor") >= 0;
        }
        return true;
    }

    function collectSelectedBuilds(){
        selectedBuilds = [];
        if(ui == null || ui.state == null) return;
        var minX = Math.min(ui.state.buildSelectionStartX, ui.state.buildSelectionEndX);
        var maxX = Math.max(ui.state.buildSelectionStartX, ui.state.buildSelectionEndX);
        var minY = Math.min(ui.state.buildSelectionStartY, ui.state.buildSelectionEndY);
        var maxY = Math.max(ui.state.buildSelectionStartY, ui.state.buildSelectionEndY);
        var filter = ui.state.buildSelectionFilter || "all";
        eachWorldBuild(function(build){
            try{
                if(build.x >= minX && build.x <= maxX && build.y >= minY && build.y <= maxY && matchesBuildSelectionFilter(build, filter)){
                    selectedBuilds.push(build);
                }
            }catch(eBuild){}
        });
    }

    function nextWallUpgrade(block){
        if(block == null || !(block instanceof Wall)) return null;
        var best = null;
        try{
            Vars.content.blocks().each(cons(function(candidate){
                try{
                    if(candidate == null || !(candidate instanceof Wall) || candidate.size != block.size || candidate.health <= block.health) return;
                    if(best == null || candidate.health < best.health) best = candidate;
                }catch(eCandidate){}
            }));
        }catch(e){}
        return best;
    }

    function buildSelectionAction(payload){
        if(payload == null) return;
        var action = String(payload.action || "");
        if(action === "clear"){
            selectedBuilds = [];
            return;
        }
        var builds = payload.builds;
        if(builds == null) return;
        var affected = 0;
        for(var i = 0; i < builds.length; i++){
            var build = builds[i];
            try{
                if(build == null || !build.isValid()) continue;
                if(action === "heal"){
                    build.health = build.maxHealth;
                    try{ build.healthChanged(); }catch(eChanged){}
                    affected++;
                }else if(action === "replace"){
                    var replacement = payload.block;
                    if(replacement == null || replacement.size != build.block.size) continue;
                    Call.setTile(build.tile, replacement, build.team, build.rotation);
                    affected++;
                }else if(action === "upgradeWalls"){
                    var upgrade = nextWallUpgrade(build.block);
                    if(upgrade == null) continue;
                    Call.setTile(build.tile, upgrade, build.team, build.rotation);
                    affected++;
                }else if(action === "fill"){
                    var item = payload.item;
                    if(item == null) continue;
                    if(build.block instanceof ItemTurret || build.block.ammoTypes != null){
                        try{
                            if(!build.block.ammoTypes.containsKey(item)) continue;
                            try{ if(build.ammo != null) build.ammo.clear(); }catch(eClearAmmo){}
                            try{ build.totalAmmo = 0; }catch(eTotal){}
                            var bullet = build.block.ammoTypes.get(item);
                            var multiplier = bullet == null ? 1 : Math.max(0.0001, bullet.ammoMultiplier);
                            var shots = Math.max(1, Math.ceil(build.block.maxAmmo / multiplier));
                            var beforeAmmo = 0;
                            try{ beforeAmmo = build.totalAmmo; }catch(eBefore){}
                            for(var ammoIndex = 0; ammoIndex < shots + 2; ammoIndex++){
                                var currentAmmo = 0;
                                try{ currentAmmo = build.totalAmmo; }catch(eCurrent){}
                                if(currentAmmo >= build.block.maxAmmo) break;
                                build.handleItem(build, item);
                            }
                            var afterAmmo = beforeAmmo;
                            try{ afterAmmo = build.totalAmmo; }catch(eAfter){}
                            if(afterAmmo > beforeAmmo) affected++;
                        }catch(eAmmo){ Log.err("Turret ammo fill failed", eAmmo); }
                    }else{
                        var compatible = false;
                        try{ compatible = build.block.consumesItem(item); }catch(eConsume){}
                        if(!compatible){
                            try{ compatible = build.acceptStack(item, 1, Vars.player) > 0; }catch(eAccept){}
                        }
                        if(!compatible || build.items == null) continue;
                        var capacity = 0;
                        try{ capacity = Math.max(1, build.getMaximumAccepted(item)); }catch(eMax){}
                        if(capacity <= 0){ try{ capacity = Math.max(1, build.block.itemCapacity); }catch(eCap){} }
                        build.items.set(item, capacity);
                        affected++;
                    }
                }
            }catch(eBuild){
                Log.err("Selected build action failed", eBuild);
            }
        }
        try{ if(ui != null) ui.invalidateBuildOverview(); }catch(eCache){}
        notify(affected + " STRUCTURES UPDATED");
    }

    function callCommand(payload){
        if(payload == null) return;
        var cmd = String(payload.command);
        if(cmd == null) return;

        if(cmd === "settings" || cmd === "preferences"){
            try{ Vars.ui.settings.show(); }catch(e){ notify("SETTINGS OPEN FAILED"); }
            return;
        }
        if(cmd === "clearMap"){
            killBuildings(function(build){ return enemyFilterBuilding(build); });
            killUnits(function(unit){ return enemyFilterUnit(unit); });
            notify("MAP CLEARED");
            return;
        }
        if(cmd === "instantBuild"){
            Vars.state.rules.instantBuild = !Vars.state.rules.instantBuild;
            Vars.state.rules.buildSpeedMultiplier = Vars.state.rules.instantBuild ? 99999 : 1;
            notify("INSTANT BUILD: " + Vars.state.rules.instantBuild);
            return;
        }
        if(cmd === "fillAllItems"){
            fillAllItems();
            notify("CORE FILLED");
            return;
        }
        if(cmd === "clearCoreStorage"){
            clearCoreItems();
            notify("CORE CLEARED");
            return;
        }
        if(cmd === "dumpToGround"){
            clearCoreItems();
            notify("CORE ITEMS PURGED");
            return;
        }
        if(cmd === "lockStorageVals"){
            notify("STORAGE LOCK PLACEHOLDER");
            return;
        }
        if(cmd === "waves:run"){
            forceRules();
            try{ Vars.logic.runWave(); }catch(e){ Vars.state.wavetime = 0; }
            notify("WAVE TRIGGERED");
            return;
        }
        if(cmd === "waves:reset"){
            Vars.state.wave = 1;
            Vars.state.wavetime = Vars.state.rules.waveSpacing;
            notify("WAVE RESET");
            return;
        }
        if(cmd === "waves:index"){
            Vars.state.wave = Math.max(0, payload.wave == null ? 1 : payload.wave);
            notify("WAVE INDEX: " + Vars.state.wave);
            return;
        }
        if(cmd === "waves:auto"){
            forceRules();
            Vars.state.rules.waveTimer = !!payload.value;
            notify("AUTO WAVE: " + Vars.state.rules.waveTimer);
            return;
        }
        if(cmd === "waves:leaderboard"){
            notify("LEADERBOARD NOT AVAILABLE OFFLINE");
            return;
        }
        if(cmd === "world:simSpeed"){
            var mult = payload.speed == null ? 1 : Math.max(1, Math.round(payload.speed));
            applyGameSpeed(mult);
            notify("SIM MULT: x" + mult);
            return;
        }
        if(cmd === "world:speedHud"){
            if(ui != null && ui.state != null) ui.state.worldSpeedQuickAccess = !!payload.value;
            if(payload.value) ensureSpeedHud(); else removeSpeedHud();
            return;
        }
                if(cmd === "world:timeOfDay"){
            applyWorldTime(payload.value);
            return;
        }
        if(cmd === "world:windStrength"){
            worldWindStrength = Math.max(0, Number(payload.value));
            updateWeatherWind();
            try{ Vars.state.rules.dragMultiplier = Math.max(0.72, 1 - worldWindStrength * 0.02); syncRules(); }catch(eDrag){}
            notify("WIND STRENGTH: " + worldWindStrength.toFixed(1));
            return;
        }
        if(cmd === "world:fogOfWar"){
            Vars.state.rules.fog = !Vars.state.rules.fog;
            Vars.state.rules.staticFog = Vars.state.rules.fog;
            syncRules();
            notify("FOG: " + Vars.state.rules.fog);
            return;
        }
        if(cmd === "world:revealMap"){
            Vars.state.rules.fog = false;
            Vars.state.rules.staticFog = false;
            Vars.state.rules.showSpawns = true;
            try{ Vars.fogControl.forceUpdate(playerTeam()); }catch(eFog){}
            syncRules();
            notify("MAP REVEALED");
            return;
        }
        if(cmd === "world:freezeWeather"){
            clearActiveWeather();
            try{ Vars.state.rules.weather.clear(); syncRules(); }catch(e){}
            notify("WEATHER FROZEN");
            return;
        }
        if(cmd === "world:resetWeather"){
            resetWeatherRules();
            return;
        }
        if(cmd === "world:randomizeStorm"){
            var stormCreated = false;
            try{
                clearActiveWeather();
                Vars.state.rules.weather.clear();
                var intensity = Math.max(0.25, Math.min(1, 0.25 + worldWindStrength / 14));
                var angle = (Time.millis() % 36000) / 100;
                var wx = Math.cos(angle * Math.PI / 180) * worldWindStrength;
                var wy = Math.sin(angle * Math.PI / 180) * worldWindStrength;
                Weather.createWeather(Weathers.sporestorm, intensity, 60 * 90, wx, wy);
                stormCreated = true;
            }catch(e){
                try{
                    var fallbackStorm = Weathers.sporestorm.create(Math.max(0.25, Math.min(1, 0.25 + worldWindStrength / 14)), 60 * 90);
                    try{ fallbackStorm.windVector().trns(20, worldWindStrength); }catch(eWind){}
                    stormCreated = fallbackStorm != null;
                }catch(eFallback){ Log.err("Storm creation failed", eFallback); }
            }
            notify(stormCreated ? "STORM DEPLOYED" : "STORM DEPLOYMENT FAILED");
            return;
        }
        if(cmd === "world:liveLink"){
            notify("WORLD LINK OK");
            return;
        }
        if(cmd === "world:captureSector"){
            captureSectorForPlayer();
            return;
        }
        if(cmd === "builds:instant"){
            Vars.state.rules.instantBuild = !!payload.value;
            Vars.state.rules.buildSpeedMultiplier = Vars.state.rules.instantBuild ? 99999 : 1;
            notify("BUILD INSTANT: " + Vars.state.rules.instantBuild);
            return;
        }
        if(cmd === "builds:godmode"){
            Vars.state.rules.blockHealthMultiplier = payload.value ? 9999 : 1;
            healAllStructures();
            notify("STRUCTURE GODMODE: " + payload.value);
            try{ if(ui != null) ui.invalidateBuildOverview(); }catch(eCache){}
            try{ if(ui != null && ui.state != null && ui.state.tab === "builds") ui.rebuild(); }catch(eUi){}
            return;
        }
        if(cmd === "builds:beginSelection"){
            if(ui != null && ui.state != null && payload.filter != null) ui.state.buildSelectionFilter = String(payload.filter);
            beginBuildSelection();
            return;
        }
        if(cmd === "builds:healAll"){
            var healed = healAllStructures();
            notify(healed + " STRUCTURES HEALED");
            try{ if(ui != null) ui.invalidateBuildOverview(); }catch(eCache){}
            try{ if(ui != null && ui.state != null && ui.state.tab === "builds") ui.rebuild(); }catch(eUi){}
            return;
        }
        if(cmd === "builds:eliminateBases"){
            killBuildings(function(build){ return enemyFilterBuilding(build); });
            notify("ENEMY BASES ELIMINATED");
            return;
        }
        if(cmd === "builds:annihilateSector"){
            killBuildings(function(build){
                try{ return build != null && build.team != playerTeam(); }catch(e){ return false; }
            });
            killUnits(function(unit){ return enemyFilterUnit(unit); });
            notify("SECTOR ANNIHILATED");
            return;
        }
        if(cmd === "builds:mapWipe"){
            killBuildings(function(build){
                try{ return !(build.block instanceof CoreBlock) || enemyFilterBuilding(build); }catch(e){ return true; }
            });
            killUnits(function(unit){
                var pu = playerUnit();
                return pu == null || unit != pu;
            });
            notify("MAP WIPED");
            return;
        }
        if(cmd === "units:applyCustomStats"){
            var targetType = payload.unitType;
            if(targetType == null){
                notify("NO UNIT TYPE SELECTED");
                return;
            }
            var newHealth = payload.health == null ? targetType.health : Math.max(1, payload.health);
            var newShield = payload.shield == null ? 0 : Math.max(0, payload.shield);
            var newDamage = payload.damage == null ? null : Math.max(0, payload.damage);
            try{ targetType.health = newHealth; }catch(eHealth){}
            if(newDamage != null){
                try{
                    targetType.weapons.each(cons(function(weapon){
                        try{
                            if(weapon.bullet != null) weapon.bullet.damage = newDamage;
                        }catch(eWD){}
                    }));
                }catch(eWeapons){}
            }
            var team = playerTeam();
            var affected = 0;
            try{
                if(team != null){
                    var data = team.data();
                    if(data != null && data.units != null){
                        var list = data.units;
                        for(var i = 0; i < list.size; i++){
                            try{
                                var unit = list.items[i];
                                if(unit == null || unit.type !== targetType) continue;
                                try{ unit.shield = newShield; }catch(eShield){}
                                affected++;
                            }catch(eInner){}
                        }
                    }
                }
            }catch(eScan){}
            notify("STATS APPLIED: HP " + Math.round(newHealth) + ", SHIELD " + Math.round(newShield) + (newDamage != null ? ", DMG " + Math.round(newDamage) : "") + " (" + affected + " ON MAP)");
            return;
        }
        if(cmd === "player:applyStats"){
            var pu = playerUnit();
            if(pu != null && ui != null && ui.state != null){
                try{ pu.type.health = Math.max(100, ui.state.playerMaxHealth); }catch(e){}
                try{ pu.type.speed = Math.max(0.1, ui.state.playerMoveSpeed); }catch(e2){}
                try{ pu.type.mineSpeed = Math.max(0.1, ui.state.playerMineSpeedMult); }catch(e3){}
                try{ pu.health = pu.type.health; }catch(e4){}
                try{ pu.apply(StatusEffects.overclock, 60 * 20); }catch(e5){}
            }
            notify("PLAYER STATS APPLIED");
            return;
        }
        if(cmd === "player:resetStats"){
            Vars.state.rules.unitHealthMultiplier = 1;
            Vars.state.rules.unitMineSpeedMultiplier = 1;
            capturePlayerDefaults();
            var puReset = playerUnit();
            if(ui != null && ui.state != null && playerDefaults != null){
                ui.state.playerMaxHealth = playerDefaults.health;
                ui.state.playerMoveSpeed = playerDefaults.speed;
                ui.state.playerMineSpeedMult = playerDefaults.mineSpeed > 0 ? playerDefaults.mineSpeed : 1;
                ui.state.playerJumpImpulse = 12.5;
                ui.state.playerRegen = 450;
            }
            if(puReset != null && playerDefaults != null){
                try{ puReset.type.health = playerDefaults.health; }catch(e){}
                try{ puReset.type.speed = playerDefaults.speed; }catch(e2){}
                try{ puReset.type.mineSpeed = playerDefaults.mineSpeed; }catch(e3){}
            }
            notify("PLAYER STATS RESET");
            try{ if(ui != null) ui.rebuild(); }catch(e4){}
            return;
        }
        if(cmd === "player:autoRepair"){
            notify("AUTO REPAIR: " + payload.value);
            return;
        }
        if(cmd.indexOf("player:status:") === 0){
            applyPlayerStatus(cmd);
            notify("STATUS: " + cmd.substring("player:status:".length));
            return;
        }
        if(cmd === "player:healMax"){
            var pu2 = playerUnit();
            if(pu2 != null){
                try{ pu2.health = pu2.maxHealth; }catch(e){}
            }
            notify("PLAYER HEALED");
            return;
        }
        if(cmd === "player:refillAmmo"){
            var pu3 = playerUnit();
            if(pu3 != null){
                try{ pu3.ammo = pu3.type.ammoCapacity; }catch(e){}
            }
            notify("AMMO REFILLED");
            return;
        }
        if(cmd === "player:selfDestruct"){
            var pu4 = playerUnit();
            if(pu4 != null) pu4.kill();
            return;
        }
        if(cmd === "weapon:criticalChance"){
            Vars.state.rules.unitDamageMultiplier = payload.value ? 1.5 : 1;
            notify("CRITICAL CHANCE: " + payload.value);
            return;
        }
        if(cmd === "weapon:instakillLocked"){
            notify("INSTAKILL REQUIRES HIGHER CLEARANCE");
            return;
        }
        if(cmd === "weapon:applyUnits"){
            if(ui != null && ui.state != null){
                ui.state.weaponInstantReload = true;
                Vars.state.rules.unitDamageMultiplier = Math.max(1, ui.state.weaponGlobalDamage);
                applyTeamInstantReload(true);
                captureOriginals();
                for(var wi2 = 0; wi2 < weaponDefaults.length; wi2++){
                    var wd2 = weaponDefaults[wi2];
                    try{
                        if(wd2.weapon.bullet == null) continue;
                        wd2.weapon.inaccuracy = ui.state.weaponSpread;
                        wd2.weapon.bullet.damage = Math.max(wd2.damage, ui.state.weaponBulletDamage);
                        if(ui.state.weaponRange > 0){
                            // реальная дальность = speed * lifetime, поэтому пересчитываем lifetime
                            // под желаемую дальность при текущей скорости пули
                            var wSpeed = wd2.weapon.bullet.speed > 0 ? wd2.weapon.bullet.speed : (wd2.bulletSpeed > 0 ? wd2.bulletSpeed : 1);
                            wd2.weapon.bullet.lifetime = ui.state.weaponRange / wSpeed;
                            wd2.weapon.bullet.range = ui.state.weaponRange; // синхронно для UI/статов
                            if(wd2.weapon.bullet.maxRange > 0) wd2.weapon.bullet.maxRange = ui.state.weaponRange;
                        }
                    }catch(eApplyWeapon){}
                }
            }
            notify("UNIT INSTANT RELOAD ENABLED (OWN TEAM ONLY)");
            return;
        }
        if(cmd === "weapon:resetUnits"){
            applyTeamInstantReload(false);
            Vars.state.rules.unitDamageMultiplier = 1;
            for(var wi3 = 0; wi3 < weaponDefaults.length; wi3++){
                var wd3 = weaponDefaults[wi3];
                try{
                    wd3.weapon.inaccuracy = wd3.inaccuracy;
                    if(wd3.weapon.bullet != null){
                        wd3.weapon.bullet.damage = wd3.damage;
                        wd3.weapon.bullet.range = wd3.bulletRange;
                        wd3.weapon.bullet.maxRange = wd3.bulletMaxRange;
                        wd3.weapon.bullet.lifetime = wd3.bulletLifetime;
                        wd3.weapon.bullet.speed = wd3.bulletSpeed;
                    }
                }catch(eResetWeapon){}
            }
            if(ui != null && ui.state != null){
                ui.state.weaponGlobalDamage = 1.0;
                ui.state.weaponInstantReload = false;
                var su = ui.state.selectedUnit;
                if(su != null && su.weapons != null && su.weapons.size > 0){
                    try{
                        var w = su.weapons.first();
                        ui.state.weaponBulletDamage = w.bullet == null ? 0 : w.bullet.damage;
                        ui.state.weaponSpread = w.inaccuracy;
                        ui.state.weaponRange = (w.bullet != null && w.bullet.speed > 0) ? Math.round(w.bullet.speed * w.bullet.lifetime) : 240;
                    }catch(e0){
                        ui.state.weaponBulletDamage = 45;
                        ui.state.weaponRange = 240;
                        ui.state.weaponSpread = 0.5;
                    }
                }else{
                    ui.state.weaponBulletDamage = 45;
                    ui.state.weaponRange = 240;
                    ui.state.weaponSpread = 0.5;
                }
            }
            notify("UNIT WEAPON PARAMETERS RESET");
            try{ if(ui != null) ui.rebuild(); }catch(e){}
            return;
        }
        if(cmd === "weapon:applyTurrets"){
            if(ui != null && ui.state != null){
                var turretReloadMul = ui.state.turretReloadMult >= 50 ? 0 : (1 / Math.max(0.1, ui.state.turretReloadMult));
                var turretRangeMul = 1 + ui.state.turretRangeBoost / 100;
                var turretSpreadVal = ui.state.turretSpread == null ? 0 : ui.state.turretSpread;
                buffTurrets(turretReloadMul, turretSpreadVal, turretRangeMul);
                Vars.state.rules.blockDamageMultiplier = 1 + ui.state.turretDamageBoost / 100;
            }
            notify("TURRET PARAMETERS APPLIED");
            return;
        }
        if(cmd === "weapon:resetTurrets"){
            resetTurrets();
            Vars.state.rules.blockDamageMultiplier = 1;
            if(ui != null && ui.state != null){
                ui.state.turretReloadMult = 1.0;
                ui.state.turretRangeBoost = 0;
                ui.state.turretDamageBoost = 0;
                ui.state.turretSpread = 0;
            }
            notify("TURRET PARAMETERS RESET");
            try{ if(ui != null) ui.rebuild(); }catch(e){}
            return;
        }
        if(cmd === "radius:toggleTurrets"){
            if(ui != null && ui.state != null){
                ui.state.showTurretRadii = !ui.state.showTurretRadii;
                notify("TURRET RADII: " + (ui.state.showTurretRadii ? "VISIBLE" : "HIDDEN"));
            }
            return;
        }
        if(cmd === "radius:toggleUnits"){
            if(ui != null && ui.state != null){
                ui.state.showUnitRadii = !ui.state.showUnitRadii;
                notify("UNIT RADII: " + (ui.state.showUnitRadii ? "VISIBLE" : "HIDDEN"));
            }
            return;
        }
        if(cmd === "mining:buildBoost"){
            Vars.state.rules.buildSpeedMultiplier = payload.value ? 2 : 1;
            notify("BUILD BOOST: " + payload.value);
            return;
        }
        if(cmd === "mining:efficiency"){
            Vars.state.rules.unitMineSpeedMultiplier = payload.value ? 2 : 1;
            notify("EFFICIENCY BOOST: " + payload.value);
            return;
        }
        if(cmd === "mining:setSpeed"){
            var speedVal = payload.value == null ? 1 : payload.value;
            try{ Vars.state.rules.unitMineSpeedMultiplier = Math.max(0.1, speedVal); }catch(eSpeed){}
            return;
        }
        if(cmd === "mining:applyGlobalBuffs"){
            var mineTarget = playerUnit();
            var mineItem = null;
            try{ mineItem = Vars.content.item(ui != null && ui.state != null ? ui.state.selectedMiningTarget : "titanium"); }catch(eItem){}
            if(mineTarget == null){
                notify("NO CONTROLLED UNIT");
                if(ui != null && ui.state != null) ui.state.miningProtocolActive = false;
                return;
            }
            if(mineItem == null){
                notify("INVALID ORE TARGET");
                return;
            }
            var mineOk = commandUnitMine(mineTarget, mineItem, true);
            if(ui != null && ui.state != null){
                ui.state.miningProtocolActive = mineOk;
                try{ Vars.state.rules.unitMineSpeedMultiplier = Math.max(1, ui.state.miningSpeed); }catch(eSpd){}
                try{ Vars.state.rules.buildSpeedMultiplier = ui.state.miningDrillBoost ? 2 : 1; }catch(eBld){}
            }
            if(mineOk){
                notify("UNIT MINING: " + mineItem.localizedName);
            }else{
                var capMsg = "NO ORE FOUND NEARBY";
                try{
                    if(mineTarget.type != null && mineItem.hardness > mineTarget.type.mineTier){
                        capMsg = "UNIT MINE TIER TOO LOW FOR " + mineItem.localizedName;
                    }
                }catch(eCap){}
                notify(capMsg);
            }
            return;
        }
        if(cmd === "mining:stopProtocol"){
            clearUnitMining(playerUnit(), true);
            if(ui != null && ui.state != null){
                ui.state.miningProtocolActive = false;
            }
            notify("MINING PROTOCOL STOPPED");
            return;
        }
        if(cmd.indexOf("mining:priority:") === 0){
            var priorityName = cmd.substring("mining:priority:".length);
            if(ui != null && ui.state != null){
                ui.state.selectedMiningTarget = priorityName;
            }
            var priorityItem = null;
            try{ priorityItem = Vars.content.item(priorityName); }catch(ePr){}
            if(priorityItem == null){
                notify("INVALID ORE TARGET");
                return;
            }
            // Always apply immediately on PC — do not require protocol already active.
            var reOk = commandUnitMine(playerUnit(), priorityItem, true);
            if(ui != null && ui.state != null) ui.state.miningProtocolActive = reOk;
            notify(reOk ? ("MINING PRIORITY: " + priorityName.toUpperCase()) : "NO ORE FOUND NEARBY / UNIT CANNOT MINE");
            return;
        }
        if(cmd === "mining:fleetToggleItem"){
            var fleetType = payload.unitType == null ? null : String(payload.unitType);
            var fleetItemName = payload.item == null ? null : String(payload.item);
            var enabled = !!payload.enabled;
            if(fleetType == null){
                notify("NO UNIT TYPE SELECTED");
                return;
            }
            var fleetItem = null;
            try{ fleetItem = Vars.content.item(fleetItemName); }catch(eFI){}
            if(fleetItem == null){
                notify("INVALID ORE TARGET");
                return;
            }
            var fleetTeam = playerTeam();
            var fleetCount = countFleetUnits(fleetType, fleetTeam);
            if(fleetCount === 0){
                notify("NO UNITS OF THIS TYPE ON MAP");
                return;
            }
            var fleetSample = null;
            eachFleetUnit(fleetType, fleetTeam, function(u){ if(fleetSample == null) fleetSample = u; });
            try{
                if(enabled && fleetSample != null && fleetSample.type != null && fleetItem.hardness > fleetSample.type.mineTier){
                    notify("UNIT MINE TIER TOO LOW FOR " + fleetItem.localizedName);
                    return;
                }
            }catch(eCapFleet){}

            var currentList = fleetAssignments[fleetType];
            if(!Array.isArray(currentList)) currentList = currentList ? [currentList] : [];
            var pos = currentList.indexOf(fleetItemName);
            if(enabled && pos === -1) currentList.push(fleetItemName);
            if(!enabled && pos !== -1) currentList.splice(pos, 1);
            if(currentList.length === 0){
                delete fleetAssignments[fleetType];
            }else{
                fleetAssignments[fleetType] = currentList;
            }

            var fleetAssigned = toggleFleetMiningItem(fleetType, fleetItem, enabled, fleetTeam);
            notify((enabled ? "ADDED " : "REMOVED ") + fleetItem.localizedName.toUpperCase() + " (" + fleetAssigned + " UNITS, " + currentList.length + " ORES ACTIVE)");
            return;
        }
        if(cmd === "mining:fleetClear"){
            var clearType = payload.unitType == null ? null : String(payload.unitType);
            if(clearType == null) return;
            delete fleetAssignments[clearType];
            clearFleetMining(clearType, playerTeam());
            notify("FLEET MINING CLEARED");
            return;
        }
        if(cmd.indexOf("links:") === 0){
            notify("LINK EXEC: " + cmd.substring(6));
            return;
        }
        if(cmd.indexOf("console:") === 0){
            var scripts = scriptsApi();
            if(cmd === "console:clearLog"){
                if(ui != null && ui.state != null) ui.state.consoleLines = [];
                refreshConsole();
                notify("CONSOLE CLEARED");
                return;
            }
            if(cmd === "console:exportTrace"){
                try{
                    var out = ui != null && ui.state != null && ui.state.consoleLines != null ? ui.state.consoleLines.join("\n") : "";
                    Core.app.setClipboardText(out);
                    notify("TRACE COPIED");
                }catch(e2){
                    notify("TRACE EXPORT FAILED");
                }
                return;
            }
            if(cmd === "console:runProtocol"){
                try{
                    var text = payload.text;
                    if(text == null || String(text).length === 0) return;
                    appendConsole(") " + text);
                    var result = "Scripts unavailable";
                    try{
                        if(scripts != null) result = scripts.runConsole(String(text));
                    }catch(ex){
                        result = "Exception: " + ex;
                    }
                    appendConsole("<- " + formatConsoleResult(result));
                    refreshConsole();
                }catch(e3){
                    appendConsole("ERR: " + e3);
                    refreshConsole();
                    notify("CONSOLE EXEC FAILED");
                }
                return;
            }
            if(cmd.indexOf("console:alias:") === 0){
                var alias = cmd.substring("console:alias:".length);
                var sample = alias + ".toString()";
                appendConsole(") " + sample);
                var aliasResult = "Scripts unavailable";
                try{
                    if(scripts != null) aliasResult = scripts.runConsole(sample);
                }catch(ex2){
                    aliasResult = "Exception: " + ex2;
                }
                appendConsole("<- " + formatConsoleResult(aliasResult));
                refreshConsole();
                return;
            }
            notify("CONSOLE EXEC: " + cmd.substring(8));
            return;
        }
        if(cmd.indexOf("hotkeys:") === 0){
            if(cmd === "hotkeys:saveExit"){
                try{ if(ui != null) ui.hide(); }catch(e){}
            }
            notify("HOTKEYS EXEC: " + cmd.substring(8));
            return;
        }

        notify("COMMAND: " + cmd);
    }

    function injectItem(payload){
        if(payload == null) return;
        var item = payload.item;
        if(item == null && payload.contentName != null){
            try{ item = Vars.content.getByName(ContentType.item, String(payload.contentName)); }catch(eResolve){}
        }
        if(item == null){
            notify("ITEM NOT FOUND");
            return;
        }
        addItemToCore(item, payload.amount == null ? 1 : payload.amount);
        notify("ITEM INJECTED: " + item.name);
    }

    function spawnUnit(payload){
        if(payload == null) return;
        var unitType = payload.unit;
        if(unitType == null && payload.contentName != null){
            try{ unitType = Vars.content.getByName(ContentType.unit, String(payload.contentName)); }catch(eResolve){}
            if(unitType == null){
                try{ unitType = Vars.content.unit(String(payload.contentName)); }catch(eUnit){}
            }
        }
        if(unitType == null){
            notify("UNIT TYPE NOT FOUND");
            return;
        }
        var px = 0;
        var py = 0;
        var amount = payload.amount == null ? 1 : Math.max(1, payload.amount);
        var team = payload.enemy ? enemyTeam() : playerTeam();
        try{ px = Vars.player.x; py = Vars.player.y; }catch(e){}
        try{
            for(var i = 0; i < amount; i++){
                var ox = (i % 5) * 12;
                var oy = Math.floor(i / 5) * 12;
                unitType.spawn(team, px + ox, py + oy);
            }
            notify("UNIT SPAWNED: " + unitType.name + " x" + amount);
        }catch(e2){
            Log.err("Unit spawn failed", e2);
            notify("UNIT SPAWN FAILED");
        }
    }

    function unitAction(payload){
        if(payload == null) return;
        var action = payload.action == null ? "" : String(payload.action);
        var unit = payload.unit;
        var type = payload.unitType;

        if(action === "select"){
            return;
        }
        if(action === "armMarker"){
            if(ui != null && ui.state != null){
                ui.state.markerArmed = true;
                markerLastTapMillis = 0;
                notify("MARKER MODE: DOUBLE-TAP A WORLD TILE");
            }
            return;
        }
        if(action === "clearMarker"){
            if(ui != null && ui.state != null){
                ui.state.markerActive = false;
                ui.state.markerArmed = false;
                markerLastTapMillis = 0;
                notify("TARGET MARKER REMOVED");
            }
            return;
        }
        if(action === "moveToMarker"){
            if(unit == null || ui == null || ui.state == null || !ui.state.markerActive){
                notify("TARGET MARKER NOT SET");
                return;
            }
            try{
                unit.set(ui.state.markerX, ui.state.markerY);
                try{ unit.vel.setZero(); }catch(eVel){}
                notify("UNIT MOVED TO MARKER");
            }catch(eMove){
                Log.err("Marker teleport failed", eMove);
                notify("MARKER TELEPORT FAILED");
            }
            return;
        }
        if(action === "setStats"){
            if(unit == null) return;
            try{
                var health = Math.max(1, Number(payload.health));
                var shield = Math.max(0, Number(payload.shield));
                unit.maxHealth = health;
                unit.health = health;
                unit.shield = shield;
                notify("UNIT VITALS UPDATED");
            }catch(eStats){
                Log.err("Unit stat update failed", eStats);
                notify("UNIT VITALS UPDATE FAILED");
            }
            return;
        }
        if(action === "teleport"){
            var pu = playerUnit();
            if(unit != null && pu != null){
                try{
                    unit.set(pu.x, pu.y);
                    try{ unit.vel.setZero(); }catch(e2){}
                    notify("UNIT TELEPORTED");
                }catch(e){}
            }
            try{ if(ui != null) ui.rebuild(); }catch(e3){}
            return;
        }
        if(action === "clone"){
            if(unit != null){
                try{
                    unit.type.spawn(teamOf(unit), unit.x + 12, unit.y + 12);
                    notify("UNIT CLONED");
                }catch(e){}
            }else if(type != null){
                spawnUnit({unit: type});
            }
            try{ if(ui != null) ui.rebuild(); }catch(e4){}
            return;
        }
        if(action === "destruct"){
            try{ if(unit != null) unit.kill(); }catch(e){}
            try{ if(ui != null && ui.state != null) ui.state.selectedWorldUnit = null; }catch(e2){}
            try{ if(ui != null) ui.rebuild(); }catch(e3){}
            return;
        }
        if(action === "team"){
            try{
                if(unit != null){
                    var current = teamOf(unit);
                    var next = current == playerTeam() ? enemyTeam() : playerTeam();
                    setUnitTeam(unit, next);
                }
                notify("UNIT TEAM CHANGED");
            }catch(e){}
            try{ if(ui != null) ui.rebuild(); }catch(e2){}
            return;
        }

        var groupUnits = payload.units;
        if(action === "groupMoveToMarker" && groupUnits != null){
            if(ui == null || ui.state == null || !ui.state.markerActive){
                notify("TARGET MARKER NOT SET");
                return;
            }
            var moved = 0;
            for(var gm = 0; gm < groupUnits.length; gm++){
                try{
                    var markerUnit = groupUnits[gm];
                    if(markerUnit == null || markerUnit.dead) continue;
                    var angle = gm * 2.399963;
                    var radius = Math.sqrt(gm) * 11;
                    markerUnit.set(ui.state.markerX + Math.cos(angle) * radius, ui.state.markerY + Math.sin(angle) * radius);
                    try{ markerUnit.vel.setZero(); }catch(eVel){}
                    moved++;
                }catch(eMove){}
            }
            notify(moved + " UNITS MOVED TO MARKER");
            return;
        }
        if(action === "groupSetStats" && groupUnits != null){
            var updated = 0;
            var groupHealth = Math.max(1, Number(payload.health));
            var groupShield = Math.max(0, Number(payload.shield));
            for(var gs = 0; gs < groupUnits.length; gs++){
                try{
                    var statUnit = groupUnits[gs];
                    if(statUnit == null || statUnit.dead) continue;
                    statUnit.maxHealth = groupHealth;
                    statUnit.health = groupHealth;
                    statUnit.shield = groupShield;
                    updated++;
                }catch(eStats){}
            }
            notify(updated + " UNIT VITALS UPDATED");
            return;
        }
        if(action === "groupTeleport" && groupUnits != null){
            var pu2 = playerUnit();
            var count = 0;
            if(pu2 != null){
                for(var gi = 0; gi < groupUnits.length; gi++){
                    try{
                        var gu = groupUnits[gi];
                        if(gu == null || gu.dead) continue;
                        gu.set(pu2.x + (gi % 10) * 8, pu2.y + Math.floor(gi / 10) * 8);
                        try{ gu.vel.setZero(); }catch(eV){}
                        count++;
                    }catch(eG){}
                }
            }
            notify(count + " UNITS TELEPORTED");
            try{ if(ui != null) ui.rebuild(); }catch(eR){}
            return;
        }
        if(action === "groupClone" && groupUnits != null){
            var count2 = 0;
            for(var gi2 = 0; gi2 < groupUnits.length; gi2++){
                try{
                    var gu2 = groupUnits[gi2];
                    if(gu2 == null || gu2.dead) continue;
                    gu2.type.spawn(teamOf(gu2), gu2.x + 12, gu2.y + 12);
                    count2++;
                }catch(eG2){}
            }
            notify(count2 + " UNITS CLONED");
            try{ if(ui != null) ui.rebuild(); }catch(eR2){}
            return;
        }
        if(action === "groupTeam" && groupUnits != null){
            var count3 = 0;
            for(var gi3 = 0; gi3 < groupUnits.length; gi3++){
                try{
                    var gu3 = groupUnits[gi3];
                    if(gu3 == null || gu3.dead) continue;
                    var cur3 = teamOf(gu3);
                    var next3 = cur3 == playerTeam() ? enemyTeam() : playerTeam();
                    setUnitTeam(gu3, next3);
                    count3++;
                }catch(eG3){}
            }
            notify(count3 + " UNITS TEAM CHANGED");
            try{ if(ui != null) ui.rebuild(); }catch(eR3){}
            return;
        }
        if(action === "groupDestruct" && groupUnits != null){
            var count4 = 0;
            for(var gi4 = 0; gi4 < groupUnits.length; gi4++){
                try{
                    var gu4 = groupUnits[gi4];
                    if(gu4 == null || gu4.dead) continue;
                    gu4.kill();
                    count4++;
                }catch(eG4){}
            }
            notify(count4 + " UNITS DESTROYED");
            try{ if(ui != null && ui.state != null) ui.state.selectedWorldUnit = null; }catch(eS4){}
            try{ if(ui != null) ui.rebuild(); }catch(eR4){}
            return;
        }
    }

    function bindHandlers(modUi){
        ui = modUi;
        modUi.configure({
            handlers: {
                initialize: function(){
                    forceRules();
                    Vars.state.rules.infiniteResources = true;
                    notify("MOD ENGINE INITIALIZED");
                },
                openDocs: function(){
                    try{ Vars.ui.showInfoText("Mod Engine", "Mindustry V8 runtime controls are active."); }catch(e){ notify("DOCS UNAVAILABLE"); }
                },
                support: function(){
                    notify("SUPPORT CHANNEL NOT CONFIGURED");
                },
                language: function(payload){
                    try{ Vars.ui.language.show(); }catch(e){ notify("LANGUAGE UI UNAVAILABLE"); }
                },
                theme: function(payload){
                    try{
                        if(payload.primary != null) theme.gold.set(Color.valueOf(String(payload.primary)));
                        if(payload.secondary != null) theme.cyan.set(Color.valueOf(String(payload.secondary)));
                        if(payload.primaryDark != null) theme.goldDark.set(Color.valueOf(String(payload.primaryDark)));
                        if(payload.secondaryDark != null) theme.cyanDark.set(Color.valueOf(String(payload.secondaryDark)));
                    }catch(eTheme){}
                },
                nav: function(payload){
                    Log.info("Mod Engine tab opened: @", payload.tab);
                },
                injectItem: injectItem,
                spawnUnit: spawnUnit,
                command: callCommand,
                unitAction: unitAction,
                buildSelectionAction: buildSelectionAction
            }
        });
    }

    function drawRadiusCircle(x, y, radius, color, alpha, phase){
        ModEngineRender.rangeCircle(x, y, radius, color, alpha == null ? 0.35 : alpha, phase || 0);
    }

    function drawTargetMarker(){
        if(ui == null || ui.state == null || !ui.state.markerActive) return;
        ModEngineRender.targetMarker(ui.state.markerX, ui.state.markerY, theme.cyan, theme.gold);
    }

    function drawTurretRadii(){
        var team = playerTeam();
        try{
            Groups.build.each(cons(function(build){
                try{
                    if(build.block == null || !(build.block instanceof Turret)) return;
                    var buildTeam = null;
                    try{ buildTeam = build.team(); }catch(eT){ buildTeam = build.team; }
                    if(team != null && buildTeam != null && buildTeam != team) return;
                    var color = buildTeam != null ? buildTeam.color : Color.white;
                    drawRadiusCircle(build.x, build.y, build.block.range, color, 0.4, build.id);
                }catch(eInner){}
            }));
        }catch(e){}
    }

    function drawUnitRadii(){
        var team = playerTeam();
        if(team == null) return;
        try{
            var data = team.data();
            if(data == null || data.units == null) return;
            var list = data.units;
            for(var i = 0; i < list.size; i++){
                try{
                    var unit = list.items[i];
                    if(unit == null || unit.type == null) continue;
                    var weaponRange = 0;
                    try{ if(unit.type.maxRange > 0) weaponRange = unit.type.maxRange; }catch(eMaxRange){}
                    try{ if(unit.type.range > 0) weaponRange = Math.max(weaponRange, unit.type.range); }catch(eTypeRange){}
                    try{
                        if(unit.type.weapons != null){
                            for(var wi = 0; wi < unit.type.weapons.size; wi++){
                                var weapon = unit.type.weapons.items[wi];
                                if(weapon == null || weapon.bullet == null) continue;
                                var bulletRange = 0;
                                try{ bulletRange = Math.max(bulletRange, weapon.bullet.range); }catch(eRange){}
                                try{ bulletRange = Math.max(bulletRange, weapon.bullet.maxRange); }catch(eBulletMax){}
                                try{ bulletRange = Math.max(bulletRange, weapon.bullet.rangeOverride); }catch(eOverride){}
                                try{
                                    if(weapon.bullet.speed > 0 && weapon.bullet.lifetime > 0){
                                        bulletRange = Math.max(bulletRange, weapon.bullet.speed * weapon.bullet.lifetime);
                                    }
                                }catch(eTravel){}
                                weaponRange = Math.max(weaponRange, bulletRange);
                            }
                        }
                    }catch(eW){}
                    if(weaponRange > 0){
                        drawRadiusCircle(unit.x, unit.y, weaponRange, theme.gold, 0.3, unit.id);
                    }
                    if(unit.type.mineTier >= 0 && unit.type.mineSpeed > 0){
                        var mineRange = 0;
                        try{ mineRange = unit.type.mineRange; }catch(eM){}
                        if(mineRange > 0){
                            drawRadiusCircle(unit.x, unit.y, mineRange, theme.cyan, 0.3, unit.id + 17);
                        }
                    }
                }catch(eInner){}
            }
        }catch(e){}
    }

    function installLifecycle(modUi){
        ui = modUi;
        var miningTimer = 0;

        Events.on(ClientLoadEvent, cons(function(){
            captureOriginals();
            applyGameSpeed(1);
            Core.app.post(run(function(){
                ensureHudButton();
                ensureQuickSelectionButton();
                ensureSpeedHud();
                try{ UserWorkbench.load(); }catch(e){}
                try{
                    if(ui != null && ui.showWelcomeIfNeeded != null) ui.showWelcomeIfNeeded();
                }catch(eWelcome){}
            }));
        }));

        Events.on(WorldLoadEvent, cons(function(){
            applyGameSpeed(1);
            snapshotWeatherRules();
            playerDefaults = null;
            markerLastTapMillis = 0;
            if(ui != null && ui.state != null){
                ui.state.markerActive = false;
                ui.state.markerArmed = false;
                ui.state.buildSelectionActive = false;
                ui.state.buildSelectionDragging = false;
            }
            selectedBuilds = [];
            buildSelectionDragging = false;
            try{ if(buildSelectionInputLayer != null) buildSelectionInputLayer.remove(); }catch(eLayer){}
            buildSelectionInputLayer = null;
            removeQuickHud();
            removeSpeedHud();
            Core.app.post(run(function(){
                ensureHudButton();
                ensureQuickSelectionButton();
                ensureSpeedHud();
                capturePlayerDefaults();
            }));
        }));

        Events.on(TapEvent, cons(function(event){
            if(ui == null || ui.state == null || !ui.state.markerArmed) return;
            if(event == null || event.tile == null || event.player == null) return;
            try{ if(Vars.player != null && event.player != Vars.player) return; }catch(ePlayer){}

            var now = Time.millis();
            var tx = event.tile.x;
            var ty = event.tile.y;
            var dx = tx - markerLastTileX;
            var dy = ty - markerLastTileY;
            var isDouble = markerLastTapMillis > 0 && now - markerLastTapMillis <= 420 && dx * dx + dy * dy <= 4;
            if(isDouble){
                ui.state.markerActive = true;
                ui.state.markerArmed = false;
                ui.state.markerTileX = tx;
                ui.state.markerTileY = ty;
                ui.state.markerX = event.tile.worldx();
                ui.state.markerY = event.tile.worldy();
                markerLastTapMillis = 0;
                notify("TARGET MARKER SET: " + tx + ", " + ty);
            }else{
                markerLastTapMillis = now;
                markerLastTileX = tx;
                markerLastTileY = ty;
            }
        }));

        Events.run(Trigger.drawOver, run(function(){
            if(ui == null || ui.state == null) return;
            if(!inGame()) return;
            var drawRanges = ui.state.showTurretRadii || ui.state.showUnitRadii;
            // begin/end are isolated: private FBO, own z-layer, never touch renderer.effectBuffer
            try{
                if(drawRanges) ModEngineRender.beginRanges();
                try{
                    if(ui.state.showTurretRadii) drawTurretRadii();
                }catch(eT){}
                try{
                    if(ui.state.showUnitRadii) drawUnitRadii();
                }catch(eU){}
            }catch(eRanges){
                try{ Log.err("Mod Engine range draw failed", eRanges); }catch(eLog){}
            }finally{
                try{ if(drawRanges) ModEngineRender.endRanges(); }catch(eEnd){}
            }
            try{ drawTargetMarker(); }catch(eMarker){}
            try{
                if(ui.state.buildSelectionActive && ui.state.buildSelectionDragging){
                    ModEngineRender.selectionRect(ui.state.buildSelectionStartX, ui.state.buildSelectionStartY, ui.state.buildSelectionEndX, ui.state.buildSelectionEndY, theme.green);
                }
                for(var sb = 0; sb < selectedBuilds.length; sb++){
                    try{ if(selectedBuilds[sb] != null && selectedBuilds[sb].isValid()) ModEngineRender.selectedBuild(selectedBuilds[sb], theme.green); }catch(eSelected){}
                }
            }catch(eSelectionDraw){}
        }));

        Events.run(Trigger.update, run(function(){
            if(ui == null) return;
            if(!inGame()) return;
            try{
                if(playerDefaults == null) capturePlayerDefaults();
            }catch(eCap){}
            try{
                if(hudRoot == null || !hudRoot.hasParent()) ensureHudButton();
            }catch(e){}
            try{
                if(ui.state != null && ui.state.quickSelectionEnabled){
                    if(quickHudRoot == null || !quickHudRoot.hasParent()) ensureQuickSelectionButton();
                }else if(quickHudRoot != null){
                    removeQuickHud();
                }
            }catch(eQuick){}
            try{ if(speedHudRoot == null || !speedHudRoot.hasParent()) ensureSpeedHud(); }catch(eSpeedHud){}

            if(ui.state != null && ui.state.buildSelectionActive){
                try{
                    try{ Vars.player.shooting = false; }catch(eShoot){}
                    try{ Vars.player.unit().controlWeapons(false); }catch(eWeapons){}
                }catch(eSelection){
                    Log.err("Build selection input failed", eSelection);
                    ui.state.buildSelectionActive = false;
                    ui.state.buildSelectionDragging = false;
                    buildSelectionDragging = false;
                    try{ if(buildSelectionInputLayer != null) buildSelectionInputLayer.remove(); }catch(eRemove){}
                    buildSelectionInputLayer = null;
                }
            }

            if(ui.state != null && ui.state.playerAutoRepair){
                try{
                    var pu = playerUnit();
                    if(pu != null && pu.health < pu.maxHealth){
                        pu.heal(Math.max(1, ui.state.playerRegen / 60));
                    }
                }catch(e2){}
            }

            if(ui.state != null && ui.state.buildGodmode){
                try{ healAllStructures(); }catch(e3){}
            }

            try{
                var fleetTeamRefresh = playerTeam();
                for(var refreshTypeKey in fleetAssignments){
                    var refreshList = fleetAssignments[refreshTypeKey];
                    if(!Array.isArray(refreshList)) refreshList = refreshList ? [refreshList] : [];
                    if(refreshList.length === 0) continue;
                    eachFleetUnit(refreshTypeKey, fleetTeamRefresh, function(fu){
                        if(!unitHasMineCommand(fu)){
                            for(var ri = 0; ri < refreshList.length; ri++){
                                var refreshItem = null;
                                try{ refreshItem = Vars.content.item(refreshList[ri]); }catch(eFI){}
                                if(refreshItem != null) toggleUnitMineItem(fu, refreshItem, true);
                            }
                        }
                    });
                }
                if(ui.state != null && ui.state.miningProtocolActive){
                    var pu2 = playerUnit();
                    if(pu2 != null){
                        if(unitCargoFull(pu2)){
                            deliverCargoToCorePlayerSafe(pu2);
                        }
                    }
                }
                if(ui.state != null && ui.state.weaponInstantReload){
                    applyTeamInstantReload(true);
                }
            }catch(eRefresh){}

            miningTimer++;
            if(ui.state != null && miningTimer >= 60){
                miningTimer = 0;
                try{
                    if(ui.state.miningProtocolActive){
                        var mineUnit = playerUnit();
                        if(mineUnit == null || mineUnit.dead){
                            ui.state.miningProtocolActive = false;
                        }else{
                            var hasTarget = unitMineTile(mineUnit) != null;
                            var stillMining = false;
                            try{ stillMining = mineUnit.mining(); }catch(eMin){ stillMining = hasTarget; }
                            if(!hasTarget && !stillMining){
                                var watchItem = null;
                                try{ watchItem = Vars.content.item(ui.state.selectedMiningTarget); }catch(e5){}
                                if(watchItem != null){
                                    commandUnitMine(mineUnit, watchItem, true);
                                }
                            }
                        }
                    }
                }catch(e7){}
            }
        }));

        Events.run(Trigger.afterGameUpdate, run(function(){
            if(ui == null || ui.state == null || !ui.state.buildSelectionActive) return;
            try{ Vars.player.shooting = false; }catch(eShoot){}
            try{ Vars.player.unit().controlWeapons(false); }catch(eWeapons){}
        }));
    }

    return {
        bindHandlers: bindHandlers,
        installLifecycle: installLifecycle,
        ensureHudButton: ensureHudButton
    };
})();

module.exports = ModEngineRuntime;
})();
