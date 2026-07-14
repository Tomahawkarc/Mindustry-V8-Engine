(function(){
var ModEngineUI = require("UI/engine-ui");
var ModEngineRuntime = require("runtime");

ModEngineRuntime.bindHandlers(ModEngineUI);
ModEngineRuntime.installLifecycle(ModEngineUI);
})();
