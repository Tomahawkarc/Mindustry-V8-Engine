(function(){
var loaded = false;

function load(){
    if(loaded) return;
    loaded = true;
}

module.exports = {
    load: load
};
})();
