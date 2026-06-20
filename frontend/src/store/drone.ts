import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Waypoint, NoFlyZone, TerrainPoint, FlightPlan, DroneConfig, NoFlyZoneType } from '../types';
import {
  aStarPathfind,
  rrtPathfind,
  smoothPath,
  calculateFlightStats,
  checkTerrainCollision,
  exportKML,
  mockNoFlyZones,
  mockTerrainData,
} from '../utils/pathfinding';

export const useDroneStore = defineStore('drone', () => {
  const waypoints = ref<Waypoint[]>([]);
  const noFlyZones = ref<NoFlyZone[]>([]);
  const terrainData = ref<TerrainPoint[]>([]);
  const currentPlan = ref<FlightPlan | null>(null);
  const selectedAlgorithm = ref<'astar' | 'rrt'>('astar');
  const isSimulating = ref(false);
  const simProgress = ref(0);
  const mapCenter = ref<[number, number]>([39.9, 116.4]);
  const autoReplan = ref(true);
  const editingZoneId = ref<string | null>(null);

  const droneConfig = ref<DroneConfig>({
    maxAltitude: 500,
    maxSpeed: 20,
    batteryCapacity: 5000,
    consumptionRate: 100,
    safeDistance: 30,
  });

  // ─── Actions ──────────────────────────────────────────────────────────────
  function addWaypoint(
    lat: number,
    lng: number,
    altitude = 100,
    speed = 10,
    action: Waypoint['action'] = 'none'
  ) {
    const id = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    waypoints.value.push({ id, lat, lng, altitude, speed, action });
  }

  function removeWaypoint(id: string) {
    waypoints.value = waypoints.value.filter((w) => w.id !== id);
  }

  function updateWaypoint(id: string, updates: Partial<Waypoint>) {
    const wp = waypoints.value.find((w) => w.id === id);
    if (wp) Object.assign(wp, updates);
  }

  function planRoute(start: [number, number], goal: [number, number]) {
    const bounds = { minLat: 39.85, maxLat: 39.95, minLng: 116.35, maxLng: 116.45 };
    let raw: Waypoint[];
    if (selectedAlgorithm.value === 'astar') {
      raw = aStarPathfind(start, goal, 30, noFlyZones.value, bounds);
    } else {
      raw = rrtPathfind(start, goal, noFlyZones.value);
    }
    const smoothed = smoothPath(raw);
    waypoints.value = smoothed;
    updatePlan();
  }

  function clearRoute() {
    waypoints.value = [];
    currentPlan.value = null;
    simProgress.value = 0;
  }

  function updatePlan() {
    const stats = calculateFlightStats(waypoints.value, droneConfig.value);
    currentPlan.value = {
      id: `plan-${Date.now()}`,
      name: 'Flight Plan',
      waypoints: [...waypoints.value],
      totalDistance: stats.totalDistance,
      estimatedTime: stats.estimatedTime,
      batteryUsage: stats.batteryUsage,
    };
  }

  let simInterval: ReturnType<typeof setInterval> | null = null;

  function simulateFlight() {
    if (waypoints.value.length < 2 || isSimulating.value) return;
    isSimulating.value = true;
    simProgress.value = 0;
    simInterval = setInterval(() => {
      simProgress.value += 1;
      if (simProgress.value >= 100) {
        simProgress.value = 100;
        isSimulating.value = false;
        if (simInterval) clearInterval(simInterval);
      }
    }, 50);
  }

  function addNoFlyZone(
    center: [number, number],
    radius: number,
    name?: string,
    type: NoFlyZoneType = 'temporary',
    description?: string
  ): NoFlyZone {
    const id = `nfz-temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const zoneName = name || `临时禁飞区 ${noFlyZones.value.filter(z => z.isTemporary).length + 1}`;
    const zone: NoFlyZone = {
      id,
      name: zoneName,
      center,
      radius,
      type,
      isTemporary: type === 'temporary',
      createdAt: Date.now(),
      description,
    };
    noFlyZones.value.push(zone);
    return zone;
  }

  function updateNoFlyZone(id: string, updates: Partial<NoFlyZone>) {
    const zone = noFlyZones.value.find((z) => z.id === id);
    if (zone) {
      Object.assign(zone, updates);
    }
  }

  function removeNoFlyZone(id: string) {
    const idx = noFlyZones.value.findIndex((z) => z.id === id);
    if (idx !== -1) {
      noFlyZones.value.splice(idx, 1);
    }
    if (editingZoneId.value === id) {
      editingZoneId.value = null;
    }
  }

  function clearTemporaryZones() {
    noFlyZones.value = noFlyZones.value.filter((z) => !z.isTemporary);
    editingZoneId.value = null;
  }

  function setEditingZone(id: string | null) {
    editingZoneId.value = id;
  }

  function toggleAutoReplan() {
    autoReplan.value = !autoReplan.value;
  }

  function replanRouteIfNeeded() {
    if (autoReplan.value && waypoints.value.length >= 2 && !isSimulating.value) {
      const first = waypoints.value[0];
      const last = waypoints.value[waypoints.value.length - 1];
      planRoute([first.lat, first.lng], [last.lat, last.lng]);
    }
  }

  watch(
    () => noFlyZones.value.length,
    () => {
      replanRouteIfNeeded();
    }
  );

  function loadMockData() {
    noFlyZones.value = [...mockNoFlyZones];
    terrainData.value = mockTerrainData;
  }

  function exportPlan(): string {
    if (!currentPlan.value) return '';
    return exportKML(currentPlan.value);
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const totalDistance = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.totalDistance;
  });

  const estimatedTime = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.estimatedTime;
  });

  const batteryPercent = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.batteryUsage;
  });

  const terrainProfile = computed(() => {
    if (waypoints.value.length < 2) return [];
    return waypoints.value.map((wp) => {
      let nearestElev = 0;
      let minDist = Infinity;
      for (const tp of terrainData.value) {
        const d =
          (tp.lat - wp.lat) ** 2 + (tp.lng - wp.lng) ** 2;
        if (d < minDist) {
          minDist = d;
          nearestElev = tp.elevation;
        }
      }
      return {
        lat: wp.lat,
        lng: wp.lng,
        altitude: wp.altitude,
        terrainElevation: nearestElev,
      };
    });
  });

  const temporaryZones = computed(() =>
    noFlyZones.value.filter((z) => z.isTemporary)
  );

  const permanentZones = computed(() =>
    noFlyZones.value.filter((z) => !z.isTemporary)
  );

  return {
    waypoints,
    noFlyZones,
    terrainData,
    currentPlan,
    droneConfig,
    selectedAlgorithm,
    isSimulating,
    simProgress,
    mapCenter,
    autoReplan,
    editingZoneId,
    totalDistance,
    estimatedTime,
    batteryPercent,
    terrainProfile,
    temporaryZones,
    permanentZones,
    addWaypoint,
    removeWaypoint,
    updateWaypoint,
    planRoute,
    clearRoute,
    simulateFlight,
    loadMockData,
    exportPlan,
    updatePlan,
    addNoFlyZone,
    updateNoFlyZone,
    removeNoFlyZone,
    clearTemporaryZones,
    setEditingZone,
    toggleAutoReplan,
    replanRouteIfNeeded,
  };
});
