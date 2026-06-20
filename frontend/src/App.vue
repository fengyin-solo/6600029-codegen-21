<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import MapView from './components/MapView.vue';
import TerrainProfile from './components/TerrainProfile.vue';
import FlightStats from './components/FlightStats.vue';
import { useDroneStore } from './store/drone';
import type { NoFlyZone } from './types';

const store = useDroneStore();

const editingZoneId = ref<string | null>(null);
const editForm = ref({
  name: '',
  radius: 1500,
  description: '',
});

onMounted(() => {
  store.loadMockData();
});

function handlePlanRoute() {
  if (store.waypoints.length < 2) return;
  const first = store.waypoints[0];
  const last = store.waypoints[store.waypoints.length - 1];
  store.planRoute([first.lat, first.lng], [last.lat, last.lng]);
}

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

function startEditZone(zone: NoFlyZone) {
  editingZoneId.value = zone.id;
  store.setEditingZone(zone.id);
  editForm.value = {
    name: zone.name,
    radius: zone.radius,
    description: zone.description || '',
  };
}

function cancelEditZone() {
  editingZoneId.value = null;
  store.setEditingZone(null);
}

function saveEditZone() {
  if (!editingZoneId.value) return;
  store.updateNoFlyZone(editingZoneId.value, {
    name: editForm.value.name,
    radius: Math.max(100, Math.min(20000, editForm.value.radius)),
    description: editForm.value.description,
  });
  store.replanRouteIfNeeded();
  cancelEditZone();
}

function deleteZone(id: string) {
  store.removeNoFlyZone(id);
}

function quickAddAtCenter() {
  store.addNoFlyZone(
    [store.mapCenter[0] + (Math.random() - 0.5) * 0.02,
     store.mapCenter[1] + (Math.random() - 0.5) * 0.02],
    1500,
    undefined,
    'temporary'
  );
}

watch(() => store.editingZoneId, (newId) => {
  if (newId === null) {
    editingZoneId.value = null;
  } else if (editingZoneId.value === null) {
    const zone = store.noFlyZones.find((z) => z.id === newId);
    if (zone) startEditZone(zone);
  }
});

const activeEditingZone = computed(() =>
  editingZoneId.value
    ? store.noFlyZones.find((z) => z.id === editingZoneId.value)
    : null
);
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- Header -->
    <header class="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between">
      <h1 class="text-lg font-bold text-sky-400">
        🛸 无人机 3D 航线规划与电子围栏
      </h1>
      <div class="text-xs text-slate-500 flex items-center gap-4">
        <span>航点: <span class="text-sky-400 font-semibold">{{ store.waypoints.length }}</span></span>
        <span>永久禁区: <span class="text-purple-400 font-semibold">{{ store.permanentZones.length }}</span></span>
        <span>临时禁区: <span class="text-cyan-400 font-semibold">{{ store.temporaryZones.length }}</span></span>
      </div>
    </header>

    <!-- Main content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Map area -->
      <div class="flex-1 flex flex-col" style="width: 70%">
        <div class="flex-1 relative">
          <MapView />
        </div>

        <!-- Bottom terrain profile -->
        <div class="p-2 bg-slate-900 border-t border-slate-800">
          <TerrainProfile />
        </div>
      </div>

      <!-- Right sidebar -->
      <div class="w-[30%] min-w-[280px] bg-slate-900 border-l border-slate-800 p-3 flex flex-col gap-3 overflow-y-auto">
        <!-- Algorithm selector -->
        <div class="bg-slate-800 rounded-lg p-3">
          <h3 class="text-xs font-semibold text-slate-300 mb-2">规划算法</h3>
          <div class="flex gap-2">
            <label class="flex-1 cursor-pointer">
              <input
                type="radio"
                :value="'astar'"
                v-model="store.selectedAlgorithm"
                class="hidden peer"
              />
              <div class="text-center py-1.5 rounded text-xs font-medium peer-checked:bg-sky-700 peer-checked:text-white bg-slate-700 text-slate-400 transition">
                A* 搜索
              </div>
            </label>
            <label class="flex-1 cursor-pointer">
              <input
                type="radio"
                :value="'rrt'"
                v-model="store.selectedAlgorithm"
                class="hidden peer"
              />
              <div class="text-center py-1.5 rounded text-xs font-medium peer-checked:bg-sky-700 peer-checked:text-white bg-slate-700 text-slate-400 transition">
                RRT 随机树
              </div>
            </label>
          </div>
        </div>

        <!-- Auto replan toggle -->
        <div class="bg-slate-800 rounded-lg p-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-xs font-semibold text-slate-300">自动重新规划</h3>
              <p class="text-[10px] text-slate-500 mt-0.5">禁区变更后自动重算航线</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="store.autoReplan"
                class="sr-only peer"
              />
              <div class="w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
            </label>
          </div>
        </div>

        <!-- Actions -->
        <div class="bg-slate-800 rounded-lg p-3 space-y-2">
          <h3 class="text-xs font-semibold text-slate-300 mb-2">操作</h3>
          <button
            @click="handlePlanRoute"
            :disabled="store.waypoints.length < 2"
            class="w-full py-2 rounded text-xs font-medium bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            🧭 规划航线
          </button>
          <button
            @click="store.simulateFlight()"
            :disabled="store.isSimulating || store.waypoints.length < 2"
            class="w-full py-2 rounded text-xs font-medium bg-amber-700 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {{ store.isSimulating ? '飞行中...' : '▶ 模拟飞行' }}
          </button>

          <!-- Progress bar -->
          <div v-if="store.isSimulating || store.simProgress > 0" class="space-y-1">
            <div class="flex justify-between text-[10px] text-slate-400">
              <span>模拟进度</span>
              <span>{{ store.simProgress }}%</span>
            </div>
            <div class="w-full bg-slate-700 rounded-full h-2">
              <div
                class="h-2 rounded-full transition-all bg-amber-500"
                :style="{ width: store.simProgress + '%' }"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              @click="quickAddAtCenter"
              class="py-2 rounded text-xs font-medium bg-cyan-800 text-white hover:bg-cyan-700 transition"
            >
              ＋ 快速添加禁区
            </button>
            <button
              @click="store.clearTemporaryZones()"
              :disabled="store.temporaryZones.length === 0"
              class="py-2 rounded text-xs font-medium bg-orange-800 text-white hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              🧹 清除临时
            </button>
          </div>

          <button
            @click="store.clearRoute()"
            class="w-full py-2 rounded text-xs font-medium bg-red-800 text-white hover:bg-red-700 transition"
          >
            🗑 清除航线
          </button>
        </div>

        <!-- Edit zone form -->
        <div v-if="activeEditingZone" class="bg-cyan-950/60 border border-cyan-700/50 rounded-lg p-3 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-cyan-300">🔧 编辑禁飞区</h3>
            <button
              @click="cancelEditZone"
              class="text-slate-400 hover:text-white text-sm leading-none"
            >✕</button>
          </div>
          <div class="text-[10px] text-cyan-500/80 mb-1">
            中心: {{ activeEditingZone.center[0].toFixed(4) }}, {{ activeEditingZone.center[1].toFixed(4) }}
          </div>
          <div class="space-y-2">
            <div>
              <label class="text-[10px] text-slate-400 block mb-1">名称</label>
              <input
                v-model="editForm.name"
                type="text"
                class="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                placeholder="禁飞区名称"
              />
            </div>
            <div>
              <div class="flex justify-between items-center mb-1">
                <label class="text-[10px] text-slate-400">半径 (米)</label>
                <span class="text-xs text-cyan-400 font-mono">{{ editForm.radius }}m</span>
              </div>
              <input
                v-model.number="editForm.radius"
                type="range"
                min="100"
                max="10000"
                step="100"
                class="w-full accent-cyan-500"
              />
              <input
                v-model.number="editForm.radius"
                type="number"
                min="100"
                max="20000"
                class="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="text-[10px] text-slate-400 block mb-1">备注</label>
              <input
                v-model="editForm.description"
                type="text"
                class="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                placeholder="可选备注信息"
              />
            </div>
          </div>
          <div class="flex gap-2 pt-1">
            <button
              @click="saveEditZone"
              class="flex-1 py-1.5 rounded text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500 transition"
            >
              💾 保存
            </button>
            <button
              @click="deleteZone(activeEditingZone.id)"
              class="py-1.5 px-3 rounded text-xs font-medium bg-red-700 text-white hover:bg-red-600 transition"
            >
              🗑
            </button>
          </div>
        </div>

        <!-- No-Fly Zones list -->
        <div class="bg-slate-800 rounded-lg p-3">
          <h3 class="text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
            <span>🚫 电子围栏管理</span>
            <span class="text-[10px] font-normal text-slate-500">
              共 {{ store.noFlyZones.length }} 个
            </span>
          </h3>

          <!-- Permanent zones -->
          <div v-if="store.permanentZones.length > 0" class="mb-3">
            <div class="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">永久禁区</div>
            <div class="space-y-1.5">
              <div
                v-for="zone in store.permanentZones"
                :key="zone.id"
                class="bg-slate-900/70 rounded p-2 border border-slate-700"
              >
                <div class="flex items-start gap-2">
                  <span
                    class="w-3 h-3 rounded-full mt-0.5 shrink-0"
                    :style="{ backgroundColor: getZoneColor(zone.type), opacity: 0.7 }"
                  ></span>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium text-slate-200 truncate">{{ zone.name }}</div>
                    <div class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span
                        class="px-1.5 py-0.5 rounded"
                        :style="{ backgroundColor: getZoneColor(zone.type) + '30', color: getZoneColor(zone.type) }"
                      >
                        {{ getZoneLabel(zone.type) }}
                      </span>
                      <span>R: {{ zone.radius }}m</span>
                    </div>
                  </div>
                  <span class="text-[10px] text-slate-600">🔒</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Temporary zones -->
          <div>
            <div class="text-[10px] text-slate-500 mb-1 uppercase tracking-wider flex items-center justify-between">
              <span>临时禁区</span>
              <span class="text-cyan-500">{{ store.temporaryZones.length }}</span>
            </div>

            <div v-if="store.temporaryZones.length === 0" class="text-[10px] text-slate-600 italic text-center py-3">
              暂无临时禁飞区，点击地图或"快速添加"创建
            </div>

            <div v-else class="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              <div
                v-for="zone in store.temporaryZones"
                :key="zone.id"
                class="bg-slate-900/70 rounded p-2 border transition cursor-pointer"
                :class="[
                  editingZoneId === zone.id
                    ? 'border-cyan-500 shadow-[0_0_0_1px_rgba(6,182,212,0.3)]'
                    : 'border-slate-700 hover:border-cyan-700/60'
                ]"
                @click="startEditZone(zone)"
              >
                <div class="flex items-start gap-2">
                  <span
                    class="w-3 h-3 rounded-full mt-0.5 shrink-0 border border-dashed"
                    :style="{
                      backgroundColor: getZoneColor(zone.type) + '40',
                      borderColor: getZoneColor(zone.type),
                    }"
                  ></span>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium text-slate-200 truncate">{{ zone.name }}</div>
                    <div class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span
                        class="px-1.5 py-0.5 rounded border border-dashed"
                        :style="{
                          backgroundColor: getZoneColor(zone.type) + '20',
                          color: getZoneColor(zone.type),
                          borderColor: getZoneColor(zone.type) + '60',
                        }"
                      >
                        临时
                      </span>
                      <span class="font-mono">R: {{ zone.radius }}m</span>
                    </div>
                    <div v-if="zone.description" class="text-[10px] text-slate-600 mt-0.5 truncate">
                      {{ zone.description }}
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      @click.stop="startEditZone(zone)"
                      class="text-[10px] px-1.5 py-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      @click.stop="deleteZone(zone.id)"
                      class="text-[10px] px-1.5 py-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Flight stats -->
        <FlightStats />
      </div>
    </div>
  </div>
</template>
