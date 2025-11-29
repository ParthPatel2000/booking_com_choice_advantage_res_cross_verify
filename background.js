// ===============================
// MEMORY
// ===============================
let reservations = {};        // loaded from popup; each key is reservation#, value is object
let reservationQueue = [];    // list of reservation numbers
let currentIndex = 0;         // pointer
let botRunning = false;


function saveState() {
    chrome.storage.local.set({
        SW_STATE: {
            botRunning,
            reservations,
            reservationQueue,
            currentIndex
        }
    });
}

chrome.storage.local.get("SW_STATE", (data) => {
    if (!data.SW_STATE) return;

    botRunning = data.SW_STATE.botRunning || false;
    reservations = data.SW_STATE.reservations || {};
    reservationQueue = data.SW_STATE.reservationQueue || [];
    currentIndex = data.SW_STATE.currentIndex || 0;

    console.log("Restored state from storage:", data.SW_STATE);
});



// ===============================
// LISTEN FOR POPUP SENDING RESERVATIONS
// ===============================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_BOT") {
        botRunning = true;
        saveState();
        sendResponse({ started: true });
    }

    if (msg.type === "STOP_BOT") {
        botRunning = false;
        saveState();
        console.log("Stop bot message Received")
        sendResponse({ stopped: true });
    }

    if (msg.type === "GET_STATUS") {
        sendResponse({ running: botRunning });
    }

    // From popup → load reservations and reset
    if (msg.type === "SAVE_RESERVATIONS") {
        reservations = msg.payload || {};
        reservationQueue = Object.keys(reservations);
        currentIndex = 0;

        saveState();
        console.log("Loaded reservations:", reservations);
        chrome.storage.local.set({ CHOICE_RESULTS: reservations }, () => {
            console.log("Saved reservations to chrome.storage.local");
        });
        sendResponse({ ok: true });
    }

    // From FindReservation.do → we have a status result
    if (msg.type === "CHOICE_STATUS_RESULT") {
        console.log("Received CA status:", msg.status);

        const resKey = reservationQueue[currentIndex];
        const resObj = reservations[resKey];

        if (resObj) {
            resObj.choiceStatus = msg.status || "UNKNOWN";
            resObj.choice_arrival = msg.choice_arrival || null;
            resObj.choice_departure = msg.choice_departure || null;
            resObj.departureMap = msg.departureMap || null;

            chrome.storage.local.set({ CHOICE_RESULTS: reservations }, () => {
                console.log("Saved reservations to chrome.storage.local");
            });

            console.log("Updated reservation object:", resObj);
        } else {
            console.warn("Reservation not found in memory:", resKey);
        }

        // Move to next reservation
        currentIndex++;
        saveState();

        // If finished → save to storage and reset
        if (currentIndex >= reservationQueue.length) {
            console.log("All reservations processed.");
            botRunning = false;
            console.log("bot_run_Status:", botRunning)
            console.log("Final reservations with status:", reservations);

            chrome.storage.local.set({ CHOICE_RESULTS: reservations }, () => {
                console.log("Saved reservations to chrome.storage.local");
            });

            reservations = {};
            reservationQueue = [];
            currentIndex = 0;
            saveState();
            return;
        }

        // Go back to the init page for the next reservation
        chrome.tabs.update(sender.tab.id, {
            url: "https://www.choiceadvantage.com/choicehotels/FindReservationInitialize.init"
        });
    }

    // Request from popup to get current results
    if (msg.type === "GET_RESULTS") {
        let results = [];

        // If we have in-memory reservations, send them as an array
        if (Object.keys(reservations).length) {
            results = Object.values(reservations);
            sendResponse({ reservations: results });
            console.log("Sending in-memory results.: ", results)
            return true;
        }

        // Otherwise, try to get cached results from storage
        chrome.storage.local.get("CHOICE_RESULTS", (data) => {
            if (data.CHOICE_RESULTS) {
                results = Object.values(data.CHOICE_RESULTS);
            }
            sendResponse({ reservations: results });
            console.log("Sending cached results.");
        });

        return true; // required for async response
    }

    if (msg.type === "GET_CURRENT_RES") {
        const currentResKey = reservationQueue[currentIndex];
        const currentResObj = reservations[currentResKey];
        sendResponse({ currentReservation: currentResObj });
        console.log("Sending current reservation:", currentResObj);
        return true;
    }

});

// ===============================
// TAB UPDATED → INJECT CONTENT SCRIPTS
// ===============================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!botRunning) return; // only inject if bot is running
    if (changeInfo.status !== "complete") return;
    if (!tab.url) return;

    // Inject SEARCH script on Init page
    if (tab.url.includes("FindReservationInitialize.init")) {
        console.log("Injecting findReservationByDetails.js on Init");

        chrome.scripting.executeScript({
            target: { tabId },
            files: ["scripts/findReservationByDetails.js"]
        }, () => {
            console.log("findReservationByDetails.js injected");
            sendNextReservation(tabId);
        });
    }

    // Inject STATUS script on Results page
    if (tab.url.includes("FindReservation.do")) {
        console.log("Injecting findReservationStatus.js on Results page");

        chrome.scripting.executeScript({
            target: { tabId },
            files: ["scripts/findReservationStatus.js"]
        });
    }
});

// ===============================
// SEND RESERVATION TO SEARCH SCRIPT
// ===============================
function sendNextReservation(tabId) {
    if (currentIndex >= reservationQueue.length) {
        console.log("No more reservations to send.");
        return;
    }

    const resKey = reservationQueue[currentIndex];
    const reservation = reservations[resKey];

    if (!reservation) {
        console.error("Reservation object not found for key:", resKey);
        currentIndex++;
        return;
    }

    console.log("Sending reservation object:", reservation);

    chrome.tabs.sendMessage(tabId, {
        type: "SEARCH_RESERVATION",
        reservation
    });
}
