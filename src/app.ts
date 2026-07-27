// UK Canal Route — interactive day-by-day map
// Edit data/stops.json to change the trip content; this file is display logic only.
// Canal geometry lives in data/route.json (regenerate with: npm run build:route).

interface Stop {
  time: string;
  period: string;
  name: string;
  subtitle: string;
  note: string;
  lat: number;
  lng: number;
  photo: string | null;
  rating: number | null;
  ratingCount: number | null;
}

interface Day {
  id: number;
  label: string;
  date: string;
  title: string;
  summary: string;
  stops: Stop[];
}

interface TripData {
  trip: { title: string; subtitle: string; operator: string };
  days: Day[];
}

interface RouteData {
  full: [number, number][];
  days: Record<string, [number, number][]>;
}

declare const L: any; // Leaflet, loaded via CDN script tag

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function snapToRoute(
  route: [number, number][],
  pt: [number, number]
): [number, number] {
  if (!route.length) return pt;
  let best = route[0];
  let bestDist = Infinity;
  for (const p of route) {
    const d = haversineMeters(p, pt);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const [stopsRes, routeRes] = await Promise.all([
    fetch("data/stops.json"),
    fetch("data/route.json"),
  ]);
  const data: TripData = await stopsRes.json();
  const route: RouteData = await routeRes.json();

  const map = L.map("map", { zoomControl: true, attributionControl: true });
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }
  ).addTo(map);

  let currentLine: any = null;
  let currentMarkers: any[] = [];
  let activeDayId = data.days[0]?.id ?? 1;
  let activeStopIndex: number | null = null;
  let youAreHereMarker: any = null;
  let lastSnappedPos: [number, number] | null = null;

  const tabsEl = document.getElementById("tabs") as HTMLElement;
  const panelEl = document.getElementById("panel") as HTMLElement;
  const eyebrowEl = document.getElementById("panel-eyebrow") as HTMLElement;
  const titleEl = document.getElementById("panel-title") as HTMLElement;
  const summaryEl = document.getElementById("panel-summary") as HTMLElement;
  const stopListEl = document.getElementById("stop-list") as HTMLElement;
  const sheetHandle = document.getElementById("sheet-handle") as HTMLElement;
  const locateBtn = document.getElementById("locate-btn") as HTMLButtonElement;
  const locNotice = document.getElementById("loc-notice") as HTMLElement;

  function renderTabs(): void {
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

  function markerHtml(stop: Stop, index: number): string {
    const bg = stop.photo
      ? `style="background-image:url('${stop.photo}')"`
      : "";
    const photoClass = stop.photo ? " has-photo" : "";
    return `<div class="stop-marker${photoClass}" ${bg}>
      <span class="marker-badge">${index + 1}</span>
    </div>`;
  }

  function renderMap(day: Day): void {
    currentMarkers.forEach((m) => map.removeLayer(m));
    currentMarkers = [];
    if (currentLine) map.removeLayer(currentLine);

    const dayCoords = route.days[String(day.id)];
    const latlngs: [number, number][] =
      dayCoords && dayCoords.length >= 2
        ? dayCoords
        : day.stops.map((s) => [s.lat, s.lng]);

    currentLine = L.polyline(latlngs, {
      color: "#4a90ff",
      weight: 5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    day.stops.forEach((stop, i) => {
      const icon = L.divIcon({
        html: markerHtml(stop, i),
        className: "marker-wrap",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
      marker.bindPopup(`<b>${i + 1}. ${stop.name}</b><br>${stop.time}`);
      marker.on("click", () => focusStop(i, true));
      currentMarkers.push(marker);
    });

    if (latlngs.length) {
      map.fitBounds(latlngs, { padding: [60, 60] });
    }
  }

  function renderPanel(day: Day): void {
    eyebrowEl.textContent = `${day.label.toUpperCase()} \u00b7 ${day.date}`;
    titleEl.textContent = day.title;
    summaryEl.textContent = day.summary;

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
      } else {
        photoDiv.textContent = String(i + 1);
      }

      const body = document.createElement("div");
      body.className = "stop-body";

      const ratingHtml =
        stop.rating != null
          ? `<div class="stop-rating"><span class="star">\u2605</span> ${
              stop.rating
            }${
              stop.ratingCount != null
                ? ` (${stop.ratingCount.toLocaleString()})`
                : ""
            }</div>`
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

  function focusStop(index: number, fromMap: boolean): void {
    activeStopIndex = index;
    const day = data.days.find((d) => d.id === activeDayId)!;
    const stop = day.stops[index];

    document.querySelectorAll(".stop-card").forEach((el) => {
      el.classList.toggle(
        "active",
        (el as HTMLElement).dataset.index === String(index)
      );
    });

    if (!fromMap) {
      map.flyTo([stop.lat, stop.lng], 14, { duration: 0.6 });
      currentMarkers[index]?.openPopup();
    }

    if (window.innerWidth <= 720) {
      const card = stopListEl.querySelector(
        `[data-index="${index}"]`
      ) as HTMLElement | null;
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function selectDay(dayId: number): void {
    activeDayId = dayId;
    activeStopIndex = null;
    const day = data.days.find((d) => d.id === dayId)!;
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

  function showLocNotice(message: string): void {
    locNotice.textContent = message;
    locNotice.hidden = false;
    window.setTimeout(() => {
      locNotice.hidden = true;
    }, 4500);
  }

  function updateYouAreHere(lat: number, lng: number): void {
    const snapped = snapToRoute(route.full, [lat, lng]);
    lastSnappedPos = snapped;
    if (!youAreHereMarker) {
      const icon = L.divIcon({
        html: `<div class="you-are-here"><span class="yah-pulse"></span><span class="yah-dot"></span></div>`,
        className: "yah-wrap",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      youAreHereMarker = L.marker(snapped, {
        icon,
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(map);
    } else {
      youAreHereMarker.setLatLng(snapped);
    }
    locateBtn.hidden = false;
  }

  locateBtn.onclick = () => {
    if (lastSnappedPos) {
      map.flyTo(lastSnappedPos, Math.max(map.getZoom(), 15), {
        duration: 0.5,
      });
    }
  };

  function startGeolocation(): void {
    if (!navigator.geolocation) {
      showLocNotice("Location is not available on this device.");
      return;
    }
    navigator.geolocation.watchPosition(
      (pos) => {
        updateYouAreHere(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          showLocNotice("Location permission denied. Map still works.");
        } else {
          showLocNotice("Couldn't get your location right now.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
  }

  selectDay(activeDayId);
  startGeolocation();
}

main().catch((err) => {
  console.error("Failed to load trip map:", err);
  const panelEl = document.getElementById("panel");
  if (panelEl) {
    panelEl.innerHTML = `<div style="padding:20px;color:#eef0f4;">
      Couldn't load trip data. Check the browser console for details.
    </div>`;
  }
});
