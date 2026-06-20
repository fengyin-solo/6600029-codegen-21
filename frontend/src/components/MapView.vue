<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, nextTick, computed } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDroneStore } from '../store/drone';
import type { NoFlyZone } from '../types';

const store = useDroneStore();
const mapContainer = ref<HTMLElement>();
let map: L.Map | null = null;
let waypointLayer: L.LayerGroup | null = null;
let routeLayer: L.Polyline | null = null;
let zoneLayer: L.LayerGroup | null = null;
let droneMarker: L.CircleMarker | null = null;
let previewCircle: L.Circle | null = null;
let previewCenterMarker: L.CircleMarker | null = null;
let previewRadiusHandle: L.CircleMarker | null = null;

const addWaypointMode = ref(false);
const zoneEditMode = ref<'none' | 'create' | 'edit'>('none');
const createStep = ref<'center' | 'radius'>('center');
const pendingCenter = ref<[number, number] | null>(null);
const defaultNewRadius = ref(1500);

const zoneCircleMap = new Map<string, {
  circle: L.Circle;
  centerMarker: L.CircleMarker;
  radiusHandle: L.CircleMarker;
}>();

function getZoneColor(type: NoFlyZone['type']): string {
  return type === 'airport' ? '#ef4444' :
         type === 'military' ? '#f97316' :
         type === 'restricted' ? '#a855f7' : '#06b6d4';
}

function getZoneLabel(type: NoFlyZone['type']): string {
  return type === 'airport' ? '机场' :
         type === 'military' ? '军事' :
         type === 'restricted' ? '限制' : '临时';
}

function initMap() {
  if (!mapContainer.value || map) return;
  map = L.map(mapContainer.value).setView(store.mapCenter, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);

  waypointLayer = L.layerGroup().addTo(map);
  zoneLayer = L.layerGroup().addTo(map);

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (addWaypointMode.value) {
      store.addWaypoint(e.latlng.lat, e.latlng.lng);
      return;
    }
    if (zoneEditMode.value === 'create') {
      if (createStep.value === 'center') {
        pendingCenter.value = [e.latlng.lat, e.latlng.lng];
        createStep.value = 'radius';
        updatePreviewCircle();
      }
      return;
    }
    if (zoneEditMode.value === 'edit') {
      store.setEditingZone(null);
    }
  });

  map.on('mousemove', (e: L.LeafletMouseEvent) => {
    if (zoneEditMode.value === 'create' && createStep.value === 'radius' && pendingCenter.value) {
      const d = haversine(
        pendingCenter.value[0], pendingCenter.value[1],
        e.latlng.lat, e.latlng.lng
      );
      defaultNewRadius.value = Math.max(100, Math.min(20000, Math.round(d)));
      updatePreviewCircle();
    }
  });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updatePreviewCircle() {
  if (!map) return;

  clearPreview();

  if (zoneEditMode.value !== 'create') return;

  if (createStep.value === 'center') {
    return;
  }

  if (createStep.value === 'radius' && pendingCenter.value) {
    const color = '#06b6d4';
    previewCircle = L.circle(pendingCenter.value, {
      radius: defaultNewRadius.value,
      color,
      fillColor: color,
      fillOpacity: 0.12,
      weight: 2,
      dashArray: '6,4',
    }).addTo(zoneLayer!);

    previewCenterMarker = L.circleMarker(pendingCenter.value, {
      radius: 6,
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 1,
      weight: 2,
    }).addTo(zoneLayer!);
    previewCenterMarker.bindTooltip('中心', { permanent: true, direction: 'top', offset: [0, -6], className: 'zone-tooltip' });

    const handlePos = getRadiusHandlePosition(pendingCenter.value, defaultNewRadius.value);
    previewRadiusHandle = L.circleMarker(handlePos, {
      radius: 8,
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 1,
      weight: 3,
    }).addTo(zoneLayer!);
    previewRadiusHandle.bindTooltip(`半径: ${defaultNewRadius.value}m (点击确认)`, {
      permanent: true, direction: 'right', offset: [8, 0], className: 'zone-tooltip',
    });
  }
}

function getRadiusHandlePosition(center: [number, number], radius: number): [number, number] {
  const R = 6371000;
  const rad = radius / R;
  const latRad = (center[0] * Math.PI) / 180;
  const lngRad = (center[1] * Math.PI) / 180;
  const bearing = 0;
  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(rad) +
    Math.cos(latRad) * Math.sin(rad) * Math.cos(bearing)
  );
  const newLng = lngRad + Math.atan2(
    Math.sin(bearing) * Math.sin(rad) * Math.cos(latRad),
    Math.cos(rad) - Math.sin(latRad) * Math.sin(newLat)
  );
  return [(newLat * 180) / Math.PI, (newLng * 180) / Math.PI];
}

function clearPreview() {
  if (previewCircle && zoneLayer) {
    zoneLayer.removeLayer(previewCircle);
    previewCircle = null;
  }
  if (previewCenterMarker && zoneLayer) {
    zoneLayer.removeLayer(previewCenterMarker);
    previewCenterMarker = null;
  }
  if (previewRadiusHandle && zoneLayer) {
    zoneLayer.removeLayer(previewRadiusHandle);
    previewRadiusHandle = null;
  }
}

function confirmCreateZone() {
  if (pendingCenter.value && defaultNewRadius.value > 0) {
    const newZone = store.addNoFlyZone(
      pendingCenter.value,
      defaultNewRadius.value,
      undefined,
      'temporary'
    );
    store.setEditingZone(newZone.id);
  }
  cancelCreateZone();
}

function cancelCreateZone() {
  zoneEditMode.value = 'none';
  createStep.value = 'center';
  pendingCenter.value = null;
  clearPreview();
}

function drawNoFlyZones() {
  if (!zoneLayer) return;

  for (const [id, objs] of zoneCircleMap) {
    zoneLayer.removeLayer(objs.circle);
    zoneLayer.removeLayer(objs.centerMarker);
    zoneLayer.removeLayer(objs.radiusHandle);
  }
  zoneCircleMap.clear();

  for (const zone of store.noFlyZones) {
    const color = getZoneColor(zone.type);
    const isEditing = store.editingZoneId === zone.id;
    const isTemporary = zone.isTemporary;

    const circle = L.circle([zone.center[0], zone.center[1]], {
      radius: zone.radius,
      color,
      fillColor: color,
      fillOpacity: isEditing ? 0.25 : 0.15,
      weight: isEditing ? 3 : 2,
      dashArray: isTemporary ? '8,4' : undefined,
    }).addTo(zoneLayer);

    circle.bindPopup(`
      <div style="min-width:200px; padding:4px">
        <div style="font-weight:bold; margin-bottom:6px; font-size:13px">${zone.name}</div>
        <div style="font-size:11px; color:#64748b; margin-bottom:4px">
          类型: <span style="color:${color}; font-weight:600">${getZoneLabel(zone.type)}</span>
        </div>
        <div style="font-size:11px; color:#64748b; margin-bottom:4px">
          半径: <b>${zone.radius}m</b>
        </div>
        <div style="font-size:11px; color:#64748b; margin-bottom:8px">
          中心: ${zone.center[0].toFixed(4)}, ${zone.center[1].toFixed(4)}
        </div>
        ${zone.description ? `<div style="font-size:11px; color:#64748b; margin-bottom:8px">备注: ${zone.description}</div>` : ''}
        <div style="display:flex; gap:6px; padding-top:6px; border-top:1px solid #e2e8f0">
          <button
            onclick="document.dispatchEvent(new CustomEvent('zone-edit', {detail: '${zone.id}'}))"
            style="flex:1; padding:4px 8px; background:#0ea5e9; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px"
          >编辑</button>
          ${isTemporary ? `<button
            onclick="document.dispatchEvent(new CustomEvent('zone-delete', {detail: '${zone.id}'}))"
            style="flex:1; padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px"
          >删除</button>` : ''}
        </div>
      </div>
    `);

    circle.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (isTemporary) {
        store.setEditingZone(isEditing ? null : zone.id);
      }
    });

    if (isEditing && isTemporary) {
      const centerMarker = L.circleMarker([zone.center[0], zone.center[1]], {
        radius: 7,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 1,
        weight: 2,
        draggable: true,
      }).addTo(zoneLayer);
      centerMarker.bindTooltip('拖动移动', { permanent: true, direction: 'top', offset: [0, -8], className: 'zone-tooltip' });

      centerMarker.on('dragstart', () => {
        map!.dragging.disable();
      });
      centerMarker.on('drag', (e: any) => {
        const ll = e.target.getLatLng();
        store.updateNoFlyZone(zone.id, { center: [ll.lat, ll.lng] });
      });
      centerMarker.on('dragend', (e: any) => {
        const ll = e.target.getLatLng();
        store.updateNoFlyZone(zone.id, { center: [ll.lat, ll.lng] });
        map!.dragging.enable();
        store.replanRouteIfNeeded();
      });

      const handlePos = getRadiusHandlePosition(zone.center, zone.radius);
      const radiusHandle = L.circleMarker(handlePos, {
        radius: 9,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 1,
        weight: 3,
        draggable: true,
      }).addTo(zoneLayer);
      radiusHandle.bindTooltip(`拖动调整 (${zone.radius}m)`, {
        permanent: true, direction: 'right', offset: [10, 0], className: 'zone-tooltip',
      });

      radiusHandle.on('dragstart', () => {
        map!.dragging.disable();
      });
      radiusHandle.on('drag', (e: any) => {
        const ll = e.target.getLatLng();
        const d = haversine(zone.center[0], zone.center[1], ll.lat, ll.lng);
        const newRadius = Math.max(100, Math.min(20000, Math.round(d)));
        store.updateNoFlyZone(zone.id, { radius: newRadius });
      });
      radiusHandle.on('dragend', (e: any) => {
        const ll = e.target.getLatLng();
        const d = haversine(zone.center[0], zone.center[1], ll.lat, ll.lng);
        const newRadius = Math.max(100, Math.min(20000, Math.round(d)));
        store.updateNoFlyZone(zone.id, { radius: newRadius });
        map!.dragging.enable();
        store.replanRouteIfNeeded();
      });

      zoneCircleMap.set(zone.id, { circle, centerMarker, radiusHandle });
    } else {
      zoneCircleMap.set(zone.id, { circle, centerMarker: null as any, radiusHandle: null as any });
    }
  }
}

function drawWaypoints() {
  if (!waypointLayer) return;
  waypointLayer.clearLayers();
  store.waypoints.forEach((wp, idx) => {
    const marker = L.circleMarker([wp.lat, wp.lng], {
      radius: 8,
      color: '#3b82f6',
      fillColor: '#60a5fa',
      fillOpacity: 0.9,
      weight: 2,
      draggable: true,
    });
    marker.bindTooltip(`WP${idx + 1}`, { permanent: true, direction: 'top', className: 'wp-tooltip' });
    marker.bindPopup(`
      <div style="min-width:160px">
        <b>Waypoint ${idx + 1}</b><br>
        Altitude: ${wp.altitude}m<br>
        Speed: ${wp.speed} m/s<br>
        Action: ${wp.action}<br>
        <button onclick="this.closest('.leaflet-popup').remove()" style="margin-top:4px;color:#ef4444">Remove</button>
      </div>
    `);
    marker.on('dragend', (e: any) => {
      const ll = e.target.getLatLng();
      store.updateWaypoint(wp.id, { lat: ll.lat, lng: ll.lng });
    });
    marker.addTo(waypointLayer!);
  });
}

function drawRoute() {
  if (routeLayer && map) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (store.waypoints.length < 2 || !map) return;

  const latlngs = store.waypoints.map((w) => [w.lat, w.lng] as [number, number]);

  let hasDanger = false;
  for (const wp of store.waypoints) {
    for (const zone of store.noFlyZones) {
      const d = Math.sqrt(
        (wp.lat - zone.center[0]) ** 2 + (wp.lng - zone.center[1]) ** 2
      ) * 111000;
      if (d < zone.radius * 1.5) hasDanger = true;
    }
  }

  routeLayer = L.polyline(latlngs, {
    color: hasDanger ? '#ef4444' : '#22c55e',
    weight: 3,
    opacity: 0.8,
    dashArray: hasDanger ? '8,4' : undefined,
  }).addTo(map);
}

function drawSimDrone() {
  if (!map || store.waypoints.length < 2) return;
  const progress = store.simProgress / 100;
  const totalWp = store.waypoints.length;
  const segIdx = Math.min(Math.floor(progress * (totalWp - 1)), totalWp - 2);
  const segProgress = (progress * (totalWp - 1)) - segIdx;
  const wp1 = store.waypoints[segIdx];
  const wp2 = store.waypoints[segIdx + 1];
  const lat = wp1.lat + (wp2.lat - wp1.lat) * segProgress;
  const lng = wp1.lng + (wp2.lng - wp1.lng) * segProgress;

  if (droneMarker) {
    droneMarker.setLatLng([lat, lng]);
  } else {
    droneMarker = L.circleMarker([lat, lng], {
      radius: 10,
      color: '#fbbf24',
      fillColor: '#f59e0b',
      fillOpacity: 1,
      weight: 3,
    }).addTo(map);
  }
}

function handleZoneEdit(e: CustomEvent) {
  const id = e.detail as string;
  store.setEditingZone(id);
}

function handleZoneDelete(e: CustomEvent) {
  const id = e.detail as string;
  store.removeNoFlyZone(id);
}

watch(() => store.waypoints.length, () => {
  drawWaypoints();
  drawRoute();
});

watch(() => [store.noFlyZones.value.length, store.editingZoneId], () => {
  drawNoFlyZones();
  drawRoute();
}, { deep: true });

watch(() => store.noFlyZones.value.map(z => `${z.id}:${z.center}:${z.radius}`).join(','), () => {
  drawNoFlyZones();
  drawRoute();
});

watch(() => store.simProgress, drawSimDrone);

watch([zoneEditMode, createStep, defaultNewRadius], () => {
  updatePreviewCircle();
});

onMounted(() => {
  nextTick(initMap);
  document.addEventListener('zone-edit', handleZoneEdit as EventListener);
  document.addEventListener('zone-delete', handleZoneDelete as EventListener);
});

onUnmounted(() => {
  document.removeEventListener('zone-edit', handleZoneEdit as EventListener);
  document.removeEventListener('zone-delete', handleZoneDelete as EventListener);
  if (map) {
    map.remove();
    map = null;
  }
  clearPreview();
});

function toggleAddWaypointMode() {
  addWaypointMode.value = !addWaypointMode.value;
  if (addWaypointMode.value) {
    zoneEditMode.value = 'none';
    cancelCreateZone();
  }
}

function startCreateZone() {
  zoneEditMode.value = 'create';
  createStep.value = 'center';
  pendingCenter.value = null;
  addWaypointMode.value = false;
  store.setEditingZone(null);
}

function handlePlanRoute() {
  if (store.waypoints.length < 2) return;
  const first = store.waypoints[0];
  const last = store.waypoints[store.waypoints.length - 1];
  store.planRoute([first.lat, first.lng], [last.lat, last.lng]);
}

const modeHint = computed(() => {
  if (zoneEditMode.value === 'create') {
    return createStep.value === 'center'
      ? '📍 点击地图设置禁飞区中心'
      : `⭕ 拖动或点击确认半径: ${defaultNewRadius.value}m`;
  }
  if (addWaypointMode.value) return '📍 点击地图添加航点';
  if (store.editingZoneId) return '🔧 拖动中心或边缘编辑禁飞区';
  return '';
});
</script>

<template>
  <div class="relative w-full h-full">
    <div ref="mapContainer" class="w-full h-full rounded-lg" />

    <div class="absolute top-2 right-2 z-[1000] flex flex-col gap-1">
      <button
        @click="toggleAddWaypointMode"
        :class="addWaypointMode ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'"
        class="px-3 py-1.5 rounded text-xs font-medium shadow hover:opacity-90 transition flex items-center gap-1"
      >
        <span>✦</span>
        <span>{{ addWaypointMode ? '添加航点中' : '添加航点' }}</span>
      </button>

      <div v-if="zoneEditMode === 'create'" class="flex gap-1">
        <button
          v-if="createStep === 'radius'"
          @click="confirmCreateZone"
          class="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-green-600 text-white shadow hover:opacity-90 transition"
        >
          ✓ 确认
        </button>
        <button
          @click="cancelCreateZone"
          class="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-red-700 text-white shadow hover:opacity-90 transition"
        >
          取消
        </button>
      </div>
      <button
        v-else
        @click="startCreateZone"
        :class="zoneEditMode === 'create' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300'"
        class="px-3 py-1.5 rounded text-xs font-medium shadow hover:opacity-90 transition flex items-center gap-1"
      >
        <span>🚫</span>
        <span>新建禁飞区</span>
      </button>

      <button
        @click="handlePlanRoute"
        class="px-3 py-1.5 rounded text-xs font-medium bg-green-700 text-white shadow hover:opacity-90 transition flex items-center gap-1"
      >
        <span>🧭</span>
        <span>规划航线</span>
      </button>
      <button
        @click="store.clearRoute()"
        class="px-3 py-1.5 rounded text-xs font-medium bg-red-700 text-white shadow hover:opacity-90 transition flex items-center gap-1"
      >
        <span>🗑</span>
        <span>清除航线</span>
      </button>
    </div>

    <div
      v-if="modeHint"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-slate-900/90 border border-cyan-500/50 rounded-lg text-xs text-cyan-300 font-medium shadow-lg backdrop-blur-sm"
    >
      {{ modeHint }}
    </div>

    <div class="absolute top-2 left-2 z-[1000] bg-slate-900/80 backdrop-blur-sm rounded-lg p-2 text-[10px] space-y-1 border border-slate-700">
      <div class="text-slate-400 font-semibold mb-1">图例</div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-red-500/40 border border-red-500"></span>
        <span class="text-slate-300">机场</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-orange-500/40 border border-orange-500"></span>
        <span class="text-slate-300">军事</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-purple-500/40 border border-purple-500"></span>
        <span class="text-slate-300">限制区</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-cyan-500/40 border border-cyan-500 border-dashed"></span>
        <span class="text-slate-300">临时</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-blue-500/80"></span>
        <span class="text-slate-300">航点</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-1 rounded bg-green-500"></span>
        <span class="text-slate-300">航线</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.wp-tooltip) {
  background: rgba(30, 41, 59, 0.9);
  color: #e2e8f0;
  border: 1px solid #475569;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
}
:deep(.zone-tooltip) {
  background: rgba(8, 47, 73, 0.95);
  color: #a5f3fc;
  border: 1px solid #0891b2;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}
:deep(.leaflet-container) {
  cursor: crosshair;
}
</style>
