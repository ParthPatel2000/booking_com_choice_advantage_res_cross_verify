// ---------------------------
// WAIT FOR RESERVATION OBJECT MESSAGE
// ---------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SEARCH_RESERVATION") {
        const res = msg.reservation;
        console.log("Received reservation:", res);
        void searchReservation(res);
    }
});



// ---------------------------
// Helper: wait for elements
// ---------------------------
function waitForElements(selectors, timeout = 5000, interval = 150) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        function check() {
            const found = selectors.map(sel => document.querySelector(sel));
            if (found.every(el => el)) return resolve(found);
            if (Date.now() - start >= timeout) return reject(new Error("Timed out waiting for elements: " + selectors.join(", ")));
            setTimeout(check, interval);
        }
        check();
    });
}

// ---------------------------
// Helper: date -> MM/DD/YYYY
// ---------------------------
function toMMDDYYYY(dateStr) {
    if (!dateStr) return "";

    const parts = dateStr.split("-");
    if (parts.length !== 3) return "";

    const yyyy = parts[0];
    const mm = parts[1];
    const dd = parts[2];

    return `${mm}/${dd}/${yyyy}`;
}

// ---------------------------
// SEARCH FUNCTION
// ---------------------------
async function searchReservation(res) {
    if (!res) return;

    const lastName = res.lastname || "";
    const firstName = res.firstname || "";
    const checkIn = toMMDDYYYY(res.checkin);
    const checkOut = checkIn;
    
    const selectors = [
        'input[name="searchLastName"]',
        'input[name="searchFirstName"]',
        'input[name="searchArrivalFromDate"]',
        'input[name="searchArrivalToDate"]'
    ];

    try {
        const [lastEl, firstEl, fromEl, toEl] = await waitForElements(selectors, 5000);

        [ [lastEl, lastName], [firstEl, firstName], [fromEl, checkIn], [toEl, checkOut] ].forEach(([el, val]) => {
            el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const btn = document.querySelector('#SubmitFindReservation');
        if (btn) btn.click();
        console.log("Search triggered for:", lastName, firstName, checkIn, checkOut);
    } catch (err) {
        console.warn(err.message);
        // fallback best-effort
        selectors.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.value = "";
        });
    }
}
