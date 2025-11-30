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
        const key = (idx + 1);

        const raw_name_str = row["Booked by"] || "";
        const { first, last } = splitBookedBy(raw_name_str);

        results[key] = {
            lastname: last,
            firstname: first,
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
    chrome.storage.local.get(["FILTER_STATUSES", "HIDE_ZERO"], data => {
        let savedStatuses = data.FILTER_STATUSES;
        let hideZero = data.HIDE_ZERO;

        // --- FIRST LOAD DEFAULTS ---
        if (!savedStatuses) {
            // all checked as default
            savedStatuses = Array.from(document.querySelectorAll(".statusFilter"))
                .map(cb => cb.value);

            chrome.storage.local.set({ FILTER_STATUSES: savedStatuses });
        }

        if (hideZero === undefined) {
            // default: hideZero = false
            hideZero = false;
            chrome.storage.local.set({ HIDE_ZERO: hideZero });
        }
        // --------------------------------------

        // apply to UI
        document.querySelectorAll(".statusFilter").forEach(cb => {
            cb.checked = savedStatuses.includes(cb.value);
        });

        document.getElementById("hideZeroCommission").checked = hideZero;

        updateNoShowList();
    });
});


document.querySelectorAll(".statusFilter").forEach(cb => {
    cb.addEventListener("change", () => {
        const selected = Array.from(document.querySelectorAll(".statusFilter:checked"))
            .map(x => x.value);

        chrome.storage.local.set({ FILTER_STATUSES: selected });
        updateNoShowList();
    });
});

document.getElementById("hideZeroCommission").addEventListener("change", (e) => {
    chrome.storage.local.set({ HIDE_ZERO: e.target.checked });
    updateNoShowList();
});




document.addEventListener("DOMContentLoaded", () => {

    const tooltip = document.getElementById("tooltip");

    // Show tooltip above/below depending on available space
    function attachTooltipListeners() {
        document.querySelectorAll("#noShowList div").forEach(line => {
            // Remove existing listeners to prevent duplicates
            line.onmouseenter = null;
            line.onmouseleave = null;

            line.addEventListener("mouseenter", () => {
                tooltip.textContent = line.dataset.tooltip;

                const rect = line.getBoundingClientRect();
                const tooltipHeight = tooltip.offsetHeight || 150;
                const spaceBelow = window.innerHeight - rect.bottom;
                const top = spaceBelow > tooltipHeight + 10
                    ? rect.bottom + window.scrollY + 5  // show below
                    : rect.top + window.scrollY - tooltipHeight - 5; // show above

                tooltip.style.top = `${top}px`;
                tooltip.style.left = `${rect.left + window.scrollX}px`;
                tooltip.style.display = "block";
            });

            line.addEventListener("mouseleave", () => {
                tooltip.style.display = "none";
            });
        });
    }

    function formatDepartureMap(departureMap) {
        if (!departureMap) return "";

        const lines = [];
        for (const [date, statuses] of Object.entries(departureMap)) {
            // If all statuses are "Checked Out", skip (no action needed)
            if (statuses.every(s => s === "Checked Out")) continue;

            // Otherwise, show date and all statuses
            lines.push(`${date} → ${statuses.join(" / ")}`);
        }

        if (!lines.length) return "All rooms departed as expected";
        return lines.join("\n"); // multiline for tooltip readability
    }

    function updateNoShowList() {
        chrome.storage.local.get("CHOICE_RESULTS", (data) => {
            const reservations = data.CHOICE_RESULTS ? Object.values(data.CHOICE_RESULTS) : [];
            const container = document.getElementById("noShowList");
            if (!container) return;

            container.innerHTML = "";

            if (!reservations.length) {
                container.textContent = "No reservations loaded.";
                return;
            }

            // Get checked status filters
            const checkedFilters = Array.from(document.querySelectorAll(".statusFilter:checked"))
                .map(cb => cb.value);

            // Get zero commission filter
            const hideZero = document.getElementById("hideZeroCommission").checked;

            reservations.forEach((data, index) => {
                const status = data.choiceStatus || "";
                const stayChanged = data.checkin !== data.choice_arrival || data.checkout !== data.choice_departure;
                const commission = data.commission_amount;

                // Filter by status
                if (!checkedFilters.includes(status) && !stayChanged) return;

                // Filter by zero commission if checkbox is checked
                if (!hideZero && (!commission || commission === 0 || commission==="NaN")) return;

                const line = document.createElement("div");
                line.textContent = `${index + 1} - ${data.lastname}, ${data.firstname} - ${status}`;

                line.dataset.tooltip =
                    `Name: ${data.firstname} ${data.lastname}\n` +
                    `Booking Status: ${data.status}\n` +
                    `Choice Advantage Status: ${status}\n` +
                    `Booking Stay: ${data.checkin} → ${data.checkout}\n` +
                    `Choice Stay: ${data.choice_arrival || null} → ${data.choice_departure || null}\n` +
                    `Rooms: ${data.rooms}\n` +
                    `Price: ${data.price}\n` +
                    `Commission: ${commission}\n` +
                    `Per Room Status:\n${formatDepartureMap(data.departureMap)}`;

                if (stayChanged) {
                    line.style.backgroundColor = "#ffcccc";
                    line.textContent += " - STAY CHANGED";
                }

                container.appendChild(line);
            });

            if (!container.hasChildNodes()) {
                container.textContent = "No reservations match the selected filters.";
            } else {
                attachTooltipListeners(); // attach listeners after all lines are rendered
            }
        });
    }


    // Initial load
    updateNoShowList();

    // Update list when storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.CHOICE_RESULTS) {
            updateNoShowList();
        }
    });

    // Optional: update list when filters change
    document.querySelectorAll(".statusFilter").forEach(cb => {
        cb.addEventListener("change", updateNoShowList);
    });
});
