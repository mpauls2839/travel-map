"use strict";
// UK Canal Route — interactive day-by-day map
// Edit data/stops.json to change the trip content; this file is display logic only.
async function main() {
    const res = await fetch("data/stops.json");
    const data = await res.json();
    const map = L.map("map", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
    }).addTo(map);
    let currentLine = null;
    let currentMarkers = [];
    let activeDayId = data.days[0]?.id ?? 1;
    let activeStopIndex = null;
    const tabsEl = document.getElementById("tabs");
    const panelEl = document.getElementById("panel");
    const eyebrowEl = document.getElementById("panel-eyebrow");
    const titleEl = document.getElementById("panel-title");
    const summaryEl = document.getElementById("panel-summary");
    const stopListEl = document.getElementById("stop-list");
    const openRouteEl = document.getElementById("open-route");
    const sheetHandle = document.getElementById("sheet-handle");
    function buildGoogleMapsUrl(day) {
        const pts = day.stops.map((s) => `${s.lat},${s.lng}`);
        const origin = pts[0];
        const destination = pts[pts.length - 1];
        const waypoints = pts.slice(1, -1).join("|");
        const params = new URLSearchParams({
            api: "1",
            origin,
            destination,
            travelmode: "driving",
        });
        let url = `https://www.google.com/maps/dir/?${params.toString()}`;
        if (waypoints)
            url += `&waypoints=${encodeURIComponent(waypoints)}`;
        return url;
    }
    function renderTabs() {
        tabsEl.innerHTML = "";
        data.days.forEach((day) => {
            const btn = document.createElement("button");
            btn.className = "tab" + (day.id === activeDayId ? " active" : "");
            btn.textContent = day.label;
            btn.setAttribute("role", "tab");
            btn.setAttribute("aria-selected", String(day.id === activeDayId));
            btn.onclick = () => selectDay(day.id);
            tabsEl.appendChild(btn);
        });
    }
    function markerHtml(stop, index) {
        const bg = stop.photo
            ? `style="background-image:url('${stop.photo}')"`
            : "";
        const label = stop.photo ? "" : String(index + 1);
        return `<div class="stop-marker${stop.photo ? " has-photo" : ""}" ${bg}>${label}</div>`;
    }
    function renderMap(day) {
        currentMarkers.forEach((m) => map.removeLayer(m));
        currentMarkers = [];
        if (currentLine)
            map.removeLayer(currentLine);
        const latlngs = day.stops.map((s) => [s.lat, s.lng]);
        currentLine = L.polyline(latlngs, {
            color: "#5b9dff",
            weight: 4,
            opacity: 0.85,
            dashArray: "1 9",
            lineCap: "round",
        }).addTo(map);
        day.stops.forEach((stop, i) => {
            const icon = L.divIcon({
                html: markerHtml(stop, i),
                className: "marker-wrap",
                iconSize: [30, 30],
                iconAnchor: [15, 15],
            });
            const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
            marker.bindPopup(`<b>${i + 1}. ${stop.name}</b><br>${stop.time}`);
            marker.on("click", () => focusStop(i, true));
            currentMarkers.push(marker);
        });
        map.fitBounds(latlngs, { padding: [60, 60] });
    }
    function renderPanel(day) {
        eyebrowEl.textContent = `${day.label.toUpperCase()} \u00b7 ${day.date}`;
        titleEl.textContent = day.title;
        summaryEl.textContent = day.summary;
        openRouteEl.href = buildGoogleMapsUrl(day);
        stopListEl.innerHTML = "";
        let lastPeriod = "";
        day.stops.forEach((stop, i) => {
            if (stop.period !== lastPeriod) {
                const label = document.createElement("div");
                label.className = "period-label";
                label.textContent = stop.period;
                stopListEl.appendChild(label);
                lastPeriod = stop.period;
            }
            const card = document.createElement("div");
            card.className = "stop-card";
            card.dataset.index = String(i);
            const photoDiv = document.createElement("div");
            photoDiv.className = "stop-photo";
            if (stop.photo) {
                photoDiv.style.backgroundImage = `url('${stop.photo}')`;
            }
            else {
                photoDiv.textContent = String(i + 1);
            }
            const body = document.createElement("div");
            body.className = "stop-body";
            const ratingHtml = stop.rating != null
                ? `<div class="stop-rating"><span class="star">\u2605</span> ${stop.rating}${stop.ratingCount != null
                    ? ` (${stop.ratingCount.toLocaleString()})`
                    : ""}</div>`
                : "";
            body.innerHTML = `
        <div class="stop-time">${stop.time}</div>
        <div class="stop-name">${stop.name}</div>
        <div class="stop-subtitle">${stop.subtitle}</div>
        <div class="stop-note">${stop.note}</div>
        ${ratingHtml}
      `;
            card.appendChild(photoDiv);
            card.appendChild(body);
            card.onclick = () => focusStop(i, false);
            stopListEl.appendChild(card);
        });
    }
    function focusStop(index, fromMap) {
        activeStopIndex = index;
        const day = data.days.find((d) => d.id === activeDayId);
        const stop = day.stops[index];
        document.querySelectorAll(".stop-card").forEach((el) => {
            el.classList.toggle("active", el.dataset.index === String(index));
        });
        if (!fromMap) {
            map.flyTo([stop.lat, stop.lng], 14, { duration: 0.6 });
            currentMarkers[index]?.openPopup();
        }
        if (window.innerWidth <= 720) {
            const card = stopListEl.querySelector(`[data-index="${index}"]`);
            card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }
    function selectDay(dayId) {
        activeDayId = dayId;
        activeStopIndex = null;
        const day = data.days.find((d) => d.id === dayId);
        renderTabs();
        renderMap(day);
        renderPanel(day);
    }
    // Mobile bottom-sheet collapse toggle
    let sheetCollapsed = false;
    sheetHandle.onclick = () => {
        sheetCollapsed = !sheetCollapsed;
        panelEl.classList.toggle("collapsed", sheetCollapsed);
        sheetHandle.style.bottom = sheetCollapsed ? "62px" : "calc(46vh - 2px)";
        sheetHandle.setAttribute("aria-expanded", String(!sheetCollapsed));
    };
    selectDay(activeDayId);
}
main().catch((err) => {
    console.error("Failed to load trip map:", err);
    const panelEl = document.getElementById("panel");
    if (panelEl) {
        panelEl.innerHTML = `<div style="padding:20px;color:#eef0f4;">
      Couldn't load trip data (data/stops.json). Check the browser console for details.
    </div>`;
    }
});
