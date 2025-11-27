document.getElementById("xlsFile").addEventListener("change", () => {
    const fileInput = document.getElementById("xlsFile");
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);

        // Parse XLS/XLSX
        const workbook = XLSX.read(data, { type: "array" });

        // Use first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON rows
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const parsed = parseXLS(rows);
        sendToBackground(parsed);
    };

    reader.readAsArrayBuffer(file);
});


function splitBookedBy(name) {
    if (!name) return { first: "", last: "" };

    const parts = name.split(",");
    if (parts.length < 2) return { first: name.trim(), last: "" };

    const last = parts[0].trim();
    const first = parts[1].trim();

    return { first, last };
}


// --- XLS PARSER ---
function parseXLS(rows) {
    const results = {};

    rows.forEach((row, idx) => {
        // Create a key since no confirmation number exists
        const key = "ROW_" + (idx + 1);

        const raw_name_str = row["Booked by"] || "";
        const { first, last } = splitBookedBy(raw_name_str);

        results[key] = {
            lastname: last,
            firstname:first,
            checkin: row["Check-in"] || "",
            checkout: row["Check-out"] || "",
            rooms: row["Rooms"] || "",
            status: row["Status"] || "",
            price: row["Price"] || "0",
            commission_amount: parseFloat(row["Commission Amount"]).toFixed(2) || 0
        };
    });

    return results;
}


// --- SEND TO BACKGROUND ---
function sendToBackground(results) {
    chrome.runtime.sendMessage(
        {
            type: "SAVE_RESERVATIONS",
            payload: results
        },
        () => {
            alert("XLS file uploaded and processed!");
        }
    );
}

document.addEventListener("DOMContentLoaded", () => {
    const runBotBtn = document.getElementById("runBot");

    // Click handler
    runBotBtn.addEventListener("click", () => {
        // Check current button state to toggle
        if (runBotBtn.textContent.includes("Run")) {
            chrome.runtime.sendMessage({ type: "START_BOT" });

            chrome.tabs.create({
                url: "https://www.choiceadvantage.com/choicehotels/FindReservationInitialize.init"
            }, (tab) => {
                console.log("Bot started on tab:", tab.id);
            });
        } else {
            chrome.runtime.sendMessage({ type: "STOP_BOT" });
        }
    });

    // Function to update button appearance
    function updateButton(running) {
        if (running) {
            runBotBtn.style.backgroundColor = "red";
            runBotBtn.textContent = "Stop Bot";
        } else {
            runBotBtn.style.backgroundColor = "green";
            runBotBtn.textContent = "Run Bot(Check Reservations on Choice)";
        }
    }

    // Poll the background every 500ms
    function pollBotStatus() {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
            if (res && typeof res.running === "boolean") {
                updateButton(res.running);
            }
        });
    }

    // Start polling
    setInterval(pollBotStatus, 500);
});


document.addEventListener("DOMContentLoaded", () => {
    
   function updateNoShowList() {
        chrome.runtime.sendMessage({ type: "GET_RESULTS" }, (response) => {
            if (!response || !response.reservations || !response.reservations.length) {
                console.log("No reservations found");
                const container = document.getElementById("noShowList");
                if (container) container.textContent = "No reservations loaded.";
                return;
            }
    
            console.log("Reservations found:", response.reservations);
    
            const checkedFilters = Array.from(document.querySelectorAll(".statusFilter:checked"))
                .map(cb => cb.value);
    
            const container = document.getElementById("noShowList");
            container.innerHTML = "";
    
            response.reservations.forEach((data, index) => {
                const status = data.choiceStatus || "";
                const stayChanged = data.checkin !== data.choice_arrival || data.checkout !== data.choice_departure;
    
                // Show if matches filters OR stay changed
                if (!checkedFilters.includes(status) && !stayChanged) return;
    
                const line = document.createElement("div");
                line.textContent = `${index + 1} - ${data.lastname}, ${data.firstname} - ${status}`;
    
                // Add tooltip for all reservations
                let tooltipText = 
                    `Name: ${data.firstname} ${data.lastname}\n` +
                    `Booking Status: ${data.status}\n` +
                    `Choice Advantage Status: ${status}\n` +
                    `Booking Stay: ${data.checkin} → ${data.checkout}\n` +
                    `Choice Stay: ${data.choice_arrival || null} → ${data.choice_departure || null}\n` +
                    `Rooms: ${data.rooms}\n` +
                    `Price: ${data.price}\n` +
                    `Commission: ${data.commission_amount}`;
            
                line.dataset.tooltip = tooltipText;
    
                // Highlight stay changes visually (optional)
                if (stayChanged) {
                    line.style.backgroundColor = "#ffcccc";
                    line.textContent += " - STAY CHANGED";
                }
    
                container.appendChild(line);
            });
    
            if (!container.hasChildNodes()) {
                container.textContent = "No reservations match the selected filters.";
            }
        });
    }

    updateNoShowList();
    setInterval(updateNoShowList, 2000);
});
