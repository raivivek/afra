/*
 * Define functions to handle page unload events.
 */
define(['jquery'], function ($) {
    /* Add a navigation warning to window with appropriate message
     * determined by doneStatus param.
     */
    $.fn.confirmDialog = function(doneStatus) {
        var confirmOnPageExit = function(evt) {
            message = "Your changes might be lost!";
            if(!doneStatus) {
                message = "There was an error submitting your changes!";
            }
            if(evt) {
                evt.returnValue = message;
            }
            return message;
        };

        window.onbeforeunload = confirmOnPageExit;
    };

    /* Removes navigation warning from window object */
    $.fn.removeDialog = function() {
        window.onbeforeunload = function () {};
    };
});
