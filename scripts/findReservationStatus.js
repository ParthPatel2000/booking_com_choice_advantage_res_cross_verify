// Wait for one of multiple elements to appear
function waitForElement(selectors, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const start = performance.now();

        function check() {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
            }

            if (performance.now() - start >= timeout)
                return reject("Timeout waiting for selectors: " + selectors.join(", "));

            requestAnimationFrame(check);
        }

        check();
    });
}

(async function () {
    console.log("findReservationStatus.js injected");

    // ---------------------------
    // GET CURRENT RESERVATION
    // ---------------------------
    const resResponse = await chrome.runtime.sendMessage({
        type: "GET_CURRENT_RES"
    });

    const currentResObj = resResponse.currentReservation;

    console.log("Current Reservation object:", currentResObj);

    try {
        // Wait for either the single reservation page OR multiple reservations page
        const statusEl = await waitForElement([
            "#reservation_summary_status",
            "#viewReservationStatus"
        ], 3000); // 3s timeout

        const statusText = statusEl.textContent.trim();

        function parseChoiceDate(dateStr) {
            // Convert MM/DD/YYYY → YYYY-MM-DD
            const [month, day, year] = dateStr.split("/").map(Number);
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }

        // Grab the arrival date
        let choice_arrival = document.querySelector("#view_reservation_arrival")?.textContent.trim()
            || document.querySelector("#reservation_summary_arrivalDate")?.textContent.trim()
            || null;

        choice_arrival = choice_arrival ? parseChoiceDate(choice_arrival) : null;


        // ------------------------------------------------------------
        // MULTI vs SINGLE (with departureMap logic)
        // ------------------------------------------------------------

        const depNodes = document.querySelectorAll("#reservation_summary_departureDate");
        const statusNodes = document.querySelectorAll("#reservation_summary_status");

        let departureMap = {};
        let choice_departure = null;
        let mostCriticalStatus = null;

        if (depNodes.length > 0) {
            // Multi reservation summary grid
            const maxLen = Math.max(depNodes.length, statusNodes.length);

            for (let i = 0; i < maxLen; i++) {
                const depNode = depNodes[i];
                const statusNode = statusNodes[i];

                const rawDep = depNode?.textContent?.trim() || null;
                const rawStatus = statusNode?.textContent?.trim() || null;

                if (!rawDep) continue;

                const parsedDep = parseChoiceDate(rawDep);

                choice_departure = currentResObj.checkout !== parsedDep ? parsedDep : null;
            
                if (!departureMap[parsedDep]) departureMap[parsedDep] = [];

                departureMap[parsedDep].push(rawStatus || null);
            }
            if(!choice_departure) choice_departure = currentResObj.checkout;

            // If only 1 departure shown in grid:
            if (depNodes.length === 1) {
                const raw = depNodes[0].textContent.trim();
                choice_departure = raw ? parseChoiceDate(raw) : null;
            }

            const priorities = ["No Show", "Cancelled", "Checked Out"];
            mostCriticalStatus = "Unknown";
        
            for (const status of priorities) {
                if (Object.values(departureMap).flat().includes(status)) {
                    mostCriticalStatus = status;
                    break;
                }
            }
            
            console.log("SUMMARY PAGE departureMap:", departureMap);

        } else {
            // No grid → single reservation page
            let rawDeparture =
                document.querySelector("#view_reservation_departure")?.textContent.trim()
                || null;

            choice_departure = rawDeparture ? parseChoiceDate(rawDeparture) : null;

            const singleStatus =
                document.querySelector("#viewReservationStatus")?.textContent.trim()
                || null;

            if (choice_departure) {
                departureMap[choice_departure] = [singleStatus || null];
            }

            console.log("SINGLE VIEW departure:", choice_departure, "status:", singleStatus);
        }

        console.log("CA Reservation Status:", statusText);
        console.log("Arrival:", choice_arrival, "Departure:", choice_departure);


        // ------------------------------------------------------------
        // SEND BACK TO BACKGROUND
        // ------------------------------------------------------------
        chrome.runtime.sendMessage({
            type: "CHOICE_STATUS_RESULT",
            status: mostCriticalStatus? mostCriticalStatus : statusText,
            choice_arrival,
            choice_departure,
            departureMap
        });

        console.log("Status and departureMap sent back to background");

    } catch (err) {
        console.error("Error getting status:", err);

        chrome.runtime.sendMessage({
            type: "CHOICE_STATUS_RESULT",
            status: null,
            choice_arrival: null,
            choice_departure: null,
            departureMap: null,
            error: err.toString()
        });
    }
})();
