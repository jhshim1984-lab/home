const storageKey = "b";
const educationStorageKey = "educationExpenses";
const academyStorageKey = "educationAcademies";
const childProfileStorageKey = "educationChildren";
const appTabStorageKey = "appTab";
const syncMetaKey = "appSyncMeta";
const remoteAppliedMetaKey = "remoteAppliedMeta";
const householdSelectionStoragePrefix = "selectedHousehold:";
const buildingNameInput = document.getElementById("buildingName");
const supabaseConfig = window.SUPABASE_CONFIG || {};
const isSupabaseConfigured = Boolean(
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  !supabaseConfig.url.includes("YOUR_PROJECT_ID") &&
  !supabaseConfig.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
);
const supabaseClient = isSupabaseConfigured && window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;
let current = 0;
let buildings = JSON.parse(localStorage.getItem(storageKey) || "null") || [newBuilding()];
let educationEntries = JSON.parse(localStorage.getItem(educationStorageKey) || "[]");
let academies = JSON.parse(localStorage.getItem(academyStorageKey) || "[]");
let childProfiles = normalizeChildProfiles(JSON.parse(localStorage.getItem(childProfileStorageKey) || "null"));
let currentAppTab = localStorage.getItem(appTabStorageKey) || "dashboard";
const initialEducationDate = new Date();
let educationMonth = `${initialEducationDate.getFullYear()}-${String(initialEducationDate.getMonth() + 1).padStart(2, "0")}`;
let educationCategoryFilter = "all";
let selectedAcademyId = "";
let childManagerCollapsed = true;
let quickAcademyDetailsCollapsed = true;
let academySectionCollapsed = true;
let directEducationSectionCollapsed = true;
const initialDashboardDate = new Date();
let dashboardMonth = `${initialDashboardDate.getFullYear()}-${String(initialDashboardDate.getMonth() + 1).padStart(2, "0")}`;
let currentSession = null;
let currentHouseholdId = "";
let currentHouseholdRole = "";
let currentHouseholds = [];
let appBooted = false;
let remoteSyncTimer = null;
let remoteNoticeTimer = null;
let remoteRealtimeChannel = null;
let remoteSyncAvailable = true;
let syncMessageShown = false;
let localSnapshotSyncedAt = localStorage.getItem(syncMetaKey) || "";
let localChangesPending = false;
let latestRemoteUpdatedAt = "";
let appliedRemoteUpdatedAt = localStorage.getItem(remoteAppliedMetaKey) || "";
let remoteUpdateAvailable = false;

function newBuilding() {
  return {
    name: "",
    address: "",
    buildingType: "multi",
    apartmentDong: "",
    apartmentHo: "",
    price: "",
    loan: "",
    rate: "4",
    buyDate: "",
    floors: [2, 2, 2, 0, 0],
    floorExcludes: ["", "", "", "", ""],
    floorCollapsed: [false, false, false, false, false],
    propertyDetailsCollapsed: true,
    floorSettingsCollapsed: true,
    rentRecords: {},
    rentExpenses: {},
    rooms: []
  };
}

function defaultChildProfiles() {
  return [
    { id: "child1", name: "자녀1" },
    { id: "child2", name: "자녀2" }
  ];
}

function normalizeChildProfiles(profiles) {
  const base = Array.isArray(profiles) && profiles.length > 0 ? profiles : defaultChildProfiles();
  const normalized = base
    .map((profile, index) => {
      const legacyId = index === 0 ? "child1" : index === 1 ? "child2" : "";
      return {
        id: String(profile?.id || legacyId || `child_${Date.now()}_${index}`).trim(),
        name: String(profile?.name || `자녀${index + 1}`).trim() || `자녀${index + 1}`
      };
    })
    .filter((profile, index, all) => profile.id && all.findIndex((item) => item.id === profile.id) === index);

  return normalized.length > 0 ? normalized : defaultChildProfiles();
}

function normalizeChildRef(value) {
  if (value === "자녀1") return "child1";
  if (value === "자녀2") return "child2";
  return String(value || "").trim();
}

function getChildProfile(childId) {
  const normalizedId = normalizeChildRef(childId);
  return childProfiles.find((profile) => profile.id === normalizedId) || null;
}

function getChildName(childId) {
  return getChildProfile(childId)?.name || "자녀";
}

function ensureChildProfile(childId) {
  const normalizedId = normalizeChildRef(childId);
  if (!normalizedId) {
    return childProfiles[0]?.id || "child1";
  }

  if (!childProfiles.some((profile) => profile.id === normalizedId)) {
    childProfiles.push({
      id: normalizedId,
      name: normalizedId === "child1" ? "자녀1" : normalizedId === "child2" ? "자녀2" : `자녀${childProfiles.length + 1}`
    });
  }

  return normalizedId;
}

function normalizeEducationData() {
  childProfiles = normalizeChildProfiles(childProfiles);

  academies = academies.map((academy) => ({
    ...academy,
    child: ensureChildProfile(academy.child)
  }));

  educationEntries = educationEntries.map((entry) => ({
    ...entry,
    child: ensureChildProfile(entry.child)
  }));
}

normalizeEducationData();

function persistLocalState(markDirty = true) {
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  localStorage.setItem(academyStorageKey, JSON.stringify(academies));
  localStorage.setItem(educationStorageKey, JSON.stringify(educationEntries));
  localStorage.setItem(childProfileStorageKey, JSON.stringify(childProfiles));
  localStorage.setItem(appTabStorageKey, currentAppTab);
  if (markDirty) {
    localChangesPending = true;
    localSnapshotSyncedAt = new Date().toISOString();
    localStorage.setItem(syncMetaKey, localSnapshotSyncedAt);
    queueRemoteSync();
  }
}

function createAppSnapshot() {
  return {
    version: 1,
    syncedAt: localSnapshotSyncedAt || new Date().toISOString(),
    current,
    currentAppTab,
    buildings,
    childProfiles,
    academies,
    educationEntries
  };
}

function applyAppSnapshot(snapshot) {
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch (_error) {
      return;
    }
  }

  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  buildings = Array.isArray(snapshot.buildings) && snapshot.buildings.length > 0
    ? snapshot.buildings
    : [newBuilding()];
  childProfiles = normalizeChildProfiles(snapshot.childProfiles);
  academies = Array.isArray(snapshot.academies) ? snapshot.academies : [];
  educationEntries = Array.isArray(snapshot.educationEntries) ? snapshot.educationEntries : [];
  normalizeEducationData();
  current = Math.min(Number(snapshot.current) || 0, Math.max(buildings.length - 1, 0));
  currentAppTab = snapshot.currentAppTab || "dashboard";
  localSnapshotSyncedAt = snapshot.syncedAt || new Date().toISOString();
  localStorage.setItem(syncMetaKey, localSnapshotSyncedAt);
  persistLocalState(false);
}

function snapshotHasContent(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  if (Array.isArray(snapshot.educationEntries) && snapshot.educationEntries.length > 0) {
    return true;
  }

  if (Array.isArray(snapshot.academies) && snapshot.academies.length > 0) {
    return true;
  }

  if (!Array.isArray(snapshot.buildings) || snapshot.buildings.length === 0) {
    return false;
  }

  return snapshot.buildings.some((building) => {
    if (!building || typeof building !== "object") {
      return false;
    }

    return Boolean(
      String(building.name || "").trim() ||
      String(building.address || "").trim() ||
      parseNumber(building.price) ||
      parseNumber(building.loan) ||
      (Array.isArray(building.rooms) && building.rooms.length > 0)
    );
  });
}

function canUseRemoteSync() {
  return Boolean(supabaseClient && currentHouseholdId && remoteSyncAvailable);
}

function rememberAppliedRemoteUpdatedAt(value) {
  appliedRemoteUpdatedAt = value || "";
  localStorage.setItem(remoteAppliedMetaKey, appliedRemoteUpdatedAt);
}

async function fetchRemoteAppState() {
  if (!canUseRemoteSync()) {
    return null;
  }

  const { data, error } = await supabaseClient.rpc("get_household_app_state", {
    target_household_id: currentHouseholdId
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return null;
  }

  return {
    payload: row.payload || null,
    updatedAt: row.updated_at || ""
  };
}

async function pushRemoteAppState() {
  if (!canUseRemoteSync()) {
    return "";
  }

  const { data, error } = await supabaseClient
    .from("app_states")
    .upsert({
      household_id: currentHouseholdId,
      payload: createAppSnapshot(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: "household_id"
    })
    .select("updated_at")
    .single();

  if (error) {
    throw error;
  }

  return data?.updated_at || new Date().toISOString();
}

function disableRemoteSyncWithMessage(message) {
  remoteSyncAvailable = false;
  if (!syncMessageShown) {
    showAuthMessage(message);
    syncMessageShown = true;
  }
}

async function syncRemoteNow() {
  if (!canUseRemoteSync()) {
    return false;
  }

  try {
    const updatedAt = await pushRemoteAppState();
    localChangesPending = false;
    latestRemoteUpdatedAt = updatedAt;
    rememberAppliedRemoteUpdatedAt(updatedAt);
    setRemoteUpdateNotice(false);
    return true;
  } catch (error) {
    disableRemoteSyncWithMessage(`Supabase 동기화 중 오류가 발생했습니다: ${error.message || error}`);
    return false;
  }
}

function queueRemoteSync() {
  if (!canUseRemoteSync()) {
    return;
  }

  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = window.setTimeout(() => {
    syncRemoteNow();
  }, 700);
}

async function refreshFromRemoteSnapshot(force = false) {
  if (!canUseRemoteSync()) {
    showAuthMessage("현재는 Supabase 동기화를 사용할 수 없는 상태입니다.");
    return;
  }

  if (!force && localChangesPending) {
    return;
  }

  try {
    showAuthMessage("원격 데이터 새로고침 중...");
    const remoteState = await fetchRemoteAppState();
    const remoteSnapshot = remoteState?.payload || null;
    const parsedSnapshot = typeof remoteSnapshot === "string"
      ? (() => {
          try {
            return JSON.parse(remoteSnapshot);
          } catch (_error) {
            return null;
          }
        })()
      : remoteSnapshot;

    if (!snapshotHasContent(parsedSnapshot)) {
      showAuthMessage("원격에 불러올 데이터가 없습니다.");
      return;
    }

    applyAppSnapshot(parsedSnapshot);
    latestRemoteUpdatedAt = remoteState?.updatedAt || parsedSnapshot?.syncedAt || "";
    rememberAppliedRemoteUpdatedAt(latestRemoteUpdatedAt);
    setRemoteUpdateNotice(false);
    if (appBooted) {
      load();
      setAppTab(currentAppTab);
    }
    const syncedAtLabel = parsedSnapshot?.syncedAt
      ? new Date(parsedSnapshot.syncedAt).toLocaleString("ko-KR")
      : "방금";
    const buildingCount = Array.isArray(parsedSnapshot?.buildings) ? parsedSnapshot.buildings.length : 0;
    const academyCount = Array.isArray(parsedSnapshot?.academies) ? parsedSnapshot.academies.length : 0;
    const entryCount = Array.isArray(parsedSnapshot?.educationEntries) ? parsedSnapshot.educationEntries.length : 0;
    const firstBuildingName = parsedSnapshot?.buildings?.[0]?.name || "(건물명 없음)";
    showAuthMessage(`원격 데이터로 새로고침했습니다. 기준 시각: ${syncedAtLabel} / 건물 ${buildingCount}개 / 첫 건물명: ${firstBuildingName} / 학원 ${academyCount}개 / 교육비 ${entryCount}건`);
  } catch (error) {
    disableRemoteSyncWithMessage(`Supabase 데이터 새로고침 중 오류가 발생했습니다: ${error.message || error}`);
  }
}

function setRemoteUpdateNotice(hasUpdate) {
  remoteUpdateAvailable = hasUpdate;
  refreshRemoteButton.classList.toggle("has-update", hasUpdate);
  refreshRemoteButton.innerText = hasUpdate ? "새 데이터 받기" : "동기화 새로고침";
}

async function checkForRemoteUpdates(options = {}) {
  const { announce = true } = options;

  if (!canUseRemoteSync()) {
    return;
  }

  try {
    const remoteState = await fetchRemoteAppState();
    const remoteUpdatedAt = remoteState?.updatedAt || "";

    if (!remoteUpdatedAt) {
      setRemoteUpdateNotice(false);
      return;
    }

    latestRemoteUpdatedAt = remoteUpdatedAt;
    const hasUpdate = !appliedRemoteUpdatedAt || remoteUpdatedAt > appliedRemoteUpdatedAt;
    setRemoteUpdateNotice(hasUpdate);

    if (hasUpdate && announce) {
      const syncedAtLabel = new Date(remoteUpdatedAt).toLocaleString("ko-KR");
      showAuthMessage(`다른 기기에서 새 데이터가 올라왔습니다. 동기화 새로고침을 누르면 반영됩니다. 기준 시각: ${syncedAtLabel}`);
    }
  } catch (error) {
    disableRemoteSyncWithMessage(`원격 변경 확인 중 오류가 발생했습니다: ${error.message || error}`);
  }
}

function startRemoteUpdatePolling() {
  clearInterval(remoteNoticeTimer);

  if (!canUseRemoteSync()) {
    return;
  }

  remoteNoticeTimer = window.setInterval(() => {
    checkForRemoteUpdates();
  }, 12000);
}

function startRemoteUpdateRealtime() {
  if (!canUseRemoteSync() || !supabaseClient) {
    return;
  }

  if (remoteRealtimeChannel) {
    supabaseClient.removeChannel(remoteRealtimeChannel);
    remoteRealtimeChannel = null;
  }

  remoteRealtimeChannel = supabaseClient
    .channel(`app-states-${currentHouseholdId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "app_states",
        filter: `household_id=eq.${currentHouseholdId}`
      },
      (payload) => {
        const nextUpdatedAt = payload?.new?.updated_at || "";
        if (!nextUpdatedAt) {
          return;
        }

        latestRemoteUpdatedAt = nextUpdatedAt;

        const hasUpdate = !appliedRemoteUpdatedAt || nextUpdatedAt > appliedRemoteUpdatedAt;
        setRemoteUpdateNotice(hasUpdate);

        if (hasUpdate) {
          const syncedAtLabel = new Date(nextUpdatedAt).toLocaleString("ko-KR");
          showAuthMessage(`다른 기기에서 새 데이터가 올라왔습니다. 새 데이터 받기를 누르면 반영됩니다. 기준 시각: ${syncedAtLabel}`);
        }
      }
    )
    .subscribe();
}

function stopRemoteUpdatePolling() {
  clearInterval(remoteNoticeTimer);
  remoteNoticeTimer = null;
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = null;
  if (remoteRealtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(remoteRealtimeChannel);
  }
  remoteRealtimeChannel = null;
  setRemoteUpdateNotice(false);
}

function bootApp() {
  if (appBooted) {
    return;
  }

  load();
  setAppTab(currentAppTab);
  appBooted = true;
}

function resetToBlankAppState() {
  buildings = [newBuilding()];
  academies = [];
  educationEntries = [];
  childProfiles = defaultChildProfiles();
  current = 0;
  currentAppTab = "dashboard";
  localSnapshotSyncedAt = new Date().toISOString();
  persistLocalState(false);
}

function showAuthMessage(message = "", isVisible = true) {
  authMessage.innerText = message;
  authMessage.classList.toggle("hidden", !isVisible || !message);
}

function setAppAccess(isAllowed) {
  appShell.classList.toggle("hidden", !isAllowed);
}

function getHouseholdSelectionKey(userId) {
  return `${householdSelectionStoragePrefix}${userId}`;
}

function getStoredHouseholdSelection(userId) {
  return localStorage.getItem(getHouseholdSelectionKey(userId)) || "";
}

function storeHouseholdSelection(userId, householdId) {
  if (!userId) {
    return;
  }
  localStorage.setItem(getHouseholdSelectionKey(userId), householdId || "");
}

async function withAuthTimeout(promise, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), 9000);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function setAuthUiLoggedOut() {
  authForm.classList.remove("hidden");
  authStatusBar.classList.add("hidden");
  authUserEmail.innerText = "-";
  householdNameLabel.innerText = "가족 데이터에 로그인해 주세요.";
  authIdentityLabel.innerText = "가족 로그인";
  householdSelect.classList.add("hidden");
  householdSelect.innerHTML = "";
}

function setAuthUiLoggedIn(userEmail, householdLabel) {
  authForm.classList.add("hidden");
  authStatusBar.classList.remove("hidden");
  authUserEmail.innerText = userEmail || "-";
  householdNameLabel.innerText = householdLabel || "가족 데이터 연결됨";
}

function getDisplayIdentity(user) {
  const metadataName = String(user?.user_metadata?.name || user?.user_metadata?.full_name || "").trim();
  if (metadataName) {
    return metadataName;
  }

  const email = String(user?.email || "").trim();
  if (!email) {
    return "가족 로그인";
  }

  return email.split("@")[0] || email;
}

function renderHouseholdSelector(userId) {
  if (!userId || currentHouseholds.length <= 1) {
    householdSelect.classList.add("hidden");
    householdSelect.innerHTML = "";
    return;
  }

  householdSelect.innerHTML = currentHouseholds.map((household) => `
    <option value="${household.householdId}">${household.householdName} · ${household.role}</option>
  `).join("");
  householdSelect.value = currentHouseholdId;
  householdSelect.classList.remove("hidden");
}

async function switchHousehold(householdId, options = {}) {
  const { userId = "", announce = true } = options;
  const nextHousehold = currentHouseholds.find((item) => item.householdId === householdId);
  if (!nextHousehold) {
    return;
  }

  stopRemoteUpdatePolling();
  currentHouseholdId = nextHousehold.householdId;
  currentHouseholdRole = nextHousehold.role;
  latestRemoteUpdatedAt = "";
  rememberAppliedRemoteUpdatedAt("");
  localChangesPending = false;
  currentAppTab = "dashboard";
  localStorage.setItem(appTabStorageKey, currentAppTab);
  storeHouseholdSelection(userId, currentHouseholdId);
  setAuthUiLoggedIn(currentSession?.user?.email, `${nextHousehold.householdName} · ${nextHousehold.role}`);
  authIdentityLabel.innerText = getDisplayIdentity(currentSession?.user);
  renderHouseholdSelector(userId);

  try {
    const remoteState = await fetchRemoteAppState();
    const remoteSnapshot = remoteState?.payload || null;
    const parsedSnapshot = typeof remoteSnapshot === "string"
      ? (() => {
          try {
            return JSON.parse(remoteSnapshot);
          } catch (_error) {
            return null;
          }
        })()
      : remoteSnapshot;

    if (snapshotHasContent(parsedSnapshot)) {
      applyAppSnapshot(parsedSnapshot);
      latestRemoteUpdatedAt = remoteState?.updatedAt || parsedSnapshot?.syncedAt || "";
      rememberAppliedRemoteUpdatedAt(latestRemoteUpdatedAt);
    } else {
      resetToBlankAppState();
      latestRemoteUpdatedAt = "";
      rememberAppliedRemoteUpdatedAt("");
    }
  } catch (_error) {
    resetToBlankAppState();
  }

  if (appBooted) {
    load();
    setAppTab("dashboard");
  }

  startRemoteUpdatePolling();
  startRemoteUpdateRealtime();
  checkForRemoteUpdates({ announce: false });

  if (announce) {
    showAuthMessage(`현재 보고 있는 데이터는 ${nextHousehold.householdName}입니다. 이 기기에서 수정한 내용은 자동으로 클라우드에 올라갑니다.`);
  }
}

async function loadCurrentHouseholds(userId) {
  if (!supabaseClient || !userId) {
    return [];
  }

  const { data, error } = await supabaseClient.rpc("get_my_households");

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const seen = new Set();
  return rows
    .map((row) => ({
      householdId: row.household_id,
      householdName: row.household_name,
      role: row.role
    }))
    .filter((row) => {
      if (!row.householdId || seen.has(row.householdId)) {
        return false;
      }
      seen.add(row.householdId);
      return true;
    });
}

async function applyAuthenticatedState(session) {
  currentSession = session;

  if (!session?.user) {
    currentHouseholdId = "";
    currentHouseholdRole = "";
    currentHouseholds = [];
    remoteSyncAvailable = true;
    syncMessageShown = false;
    latestRemoteUpdatedAt = "";
    localChangesPending = false;
    stopRemoteUpdatePolling();
    setAuthUiLoggedOut();
    setAppAccess(false);
    showAuthMessage("로그인하면 가족 데이터 동기화 연결을 이어서 붙일 수 있습니다.");
    return;
  }

  try {
    currentHouseholds = await loadCurrentHouseholds(session.user.id);
    if (!currentHouseholds.length) {
      currentHouseholdId = "";
      setAuthUiLoggedIn(session.user.email, "가족 데이터 연결이 아직 없습니다.");
      authIdentityLabel.innerText = getDisplayIdentity(session.user);
      setAppAccess(true);
      bootApp();
      showAuthMessage("이 계정은 아직 household에 연결되지 않았습니다. Supabase에서 household_members 연결을 먼저 확인해 주세요.");
      return;
    }
    remoteSyncAvailable = true;
    syncMessageShown = false;

    bootApp();
    setAppAccess(true);
    const preferredHouseholdId = getStoredHouseholdSelection(session.user.id);
    const initialHousehold = currentHouseholds.find((item) => item.householdId === preferredHouseholdId) || currentHouseholds[0];
    await switchHousehold(initialHousehold.householdId, {
      userId: session.user.id,
      announce: false
    });
  } catch (error) {
    currentHouseholdId = "";
    currentHouseholds = [];
    setAuthUiLoggedIn(session.user.email, "가족 데이터 연결 확인 보류");
    authIdentityLabel.innerText = getDisplayIdentity(session.user);
    setAppAccess(true);
    bootApp();
    showAuthMessage(`가족 데이터 연결 확인 중 오류가 발생했습니다: ${error.message || error} / 우선은 로컬 모드로 앱을 열었습니다.`);
  }
}

async function handleLogin() {
  if (!supabaseClient) {
    showAuthMessage("먼저 supabase-config.js에 Project URL과 anon key를 넣어 주세요.");
    return;
  }

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showAuthMessage("이메일과 비밀번호를 모두 입력해 주세요.");
    return;
  }

  showAuthMessage("로그인 중입니다...");
  loginButton.disabled = true;

  try {
    const { data, error } = await withAuthTimeout(
      supabaseClient.auth.signInWithPassword({
        email,
        password
      }),
      "로그인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
    );

    if (error) {
      throw error;
    }

    loginPassword.value = "";
    await applyAuthenticatedState(data.session);
  } catch (error) {
    showAuthMessage(`로그인에 실패했습니다: ${error.message || error}`);
  } finally {
    loginButton.disabled = false;
  }
}

async function handleLogout() {
  if (!supabaseClient) {
    return;
  }

  stopRemoteUpdatePolling();
  currentHouseholdId = "";
  currentHouseholdRole = "";
  currentHouseholds = [];
  currentSession = null;
  remoteSyncAvailable = true;
  syncMessageShown = false;
  latestRemoteUpdatedAt = "";
  rememberAppliedRemoteUpdatedAt("");
  localChangesPending = false;
  setRemoteUpdateNotice(false);
  setAuthUiLoggedOut();
  setAppAccess(false);
  showAuthMessage("로그아웃 중입니다...");

  const { error } = await withAuthTimeout(
    supabaseClient.auth.signOut(),
    "로그아웃이 지연되고 있습니다. 앱을 다시 열어 확인해 주세요."
  );
  if (error) {
    showAuthMessage(`로그아웃 중 오류가 발생했습니다: ${error.message || error}`);
    return;
  }

  await applyAuthenticatedState(null);
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    window.setTimeout(() => {
      window.location.replace(window.location.pathname);
    }, 60);
  }
}

async function initializeSupabaseAuth() {
  if (!supabaseClient) {
    setAuthUiLoggedOut();
    setAppAccess(true);
    bootApp();
    showAuthMessage("Supabase 설정값이 아직 비어 있어서 현재는 기기 내 저장(localStorage) 방식으로만 실행 중입니다.");
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthUiLoggedOut();
    setAppAccess(false);
    showAuthMessage(`세션 확인 중 오류가 발생했습니다: ${error.message || error}`);
    return;
  }

  await applyAuthenticatedState(data.session);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      applyAuthenticatedState(session);
    }, 0);
  });
}

function formatCurrency(value) {
  return `${Math.round(value || 0).toLocaleString()}원`;
}

function getRoomStatusLabel(isJeonse, isVacant) {
  return isVacant ? "공실" : isJeonse ? "전세" : "월세";
}

function getRoomStatusClass(isJeonse, isVacant) {
  return isVacant ? "state-vacant" : isJeonse ? "state-jeonse" : "state-monthly";
}

function getApartmentRoomLabel() {
  const dong = apartmentDong.value.trim();
  const ho = apartmentHo.value.trim();
  if (dong && ho) {
    return `${dong}동 ${ho}호`;
  }
  if (dong) {
    return `${dong}동`;
  }
  if (ho) {
    return `${ho}호`;
  }
  return "아파트";
}

function updateBuildingTypeUi() {
  const isApartment = buildingType.value === "apartment";
  apartmentFields.classList.toggle("hidden", !isApartment);
  floorSectionTitle.classList.toggle("hidden", isApartment);
  floorSettings.classList.toggle("hidden", isApartment);
}

function formatKoreanCurrencyText(value) {
  const number = Math.floor(parseNumber(value));
  if (!number) {
    return "( - )";
  }

  const units = ["", "만", "억", "조"];
  const smallUnits = ["", "십", "백", "천"];
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const parts = [];
  let remaining = number;
  let unitIndex = 0;

  while (remaining > 0 && unitIndex < units.length) {
    const chunk = remaining % 10000;
    if (chunk) {
      let chunkText = "";
      String(chunk).padStart(4, "0").split("").forEach((digit, index) => {
        const numericDigit = Number(digit);
        if (!numericDigit) {
          return;
        }
        const smallUnit = smallUnits[3 - index];
        const digitText = numericDigit === 1 && smallUnit ? "" : digits[numericDigit];
        chunkText += `${digitText}${smallUnit}`;
      });
      parts.unshift(`${chunkText}${units[unitIndex]}`);
    }
    remaining = Math.floor(remaining / 10000);
    unitIndex += 1;
  }

  return `(${parts.join(" ")}원)`;
}

function parseNumber(value) {
  return Number(String(value || "").replace(/,/g, "").trim()) || 0;
}

function formatInputNumber(value) {
  const digits = String(value || "").replace(/[^\d.-]/g, "");
  if (!digits || digits === "-" || digits === "." || digits === "-.") {
    return "";
  }

  const numericValue = Number(digits);
  if (Number.isNaN(numericValue)) {
    return "";
  }

  return numericValue.toLocaleString();
}

function formatShortDateInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

function getTodayShortDate() {
  const today = new Date();
  return formatShortDateInput(
    `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`
  );
}

function shiftShortDate(value, diffDays) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 6) {
    return getTodayShortDate();
  }

  const year = 2000 + Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const base = new Date(year, month - 1, day + diffDays);
  return formatShortDateInput(
    `${String(base.getFullYear()).slice(2)}${String(base.getMonth() + 1).padStart(2, "0")}${String(base.getDate()).padStart(2, "0")}`
  );
}

function formatPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) {
    return digits;
  }
  if (digits.length < 8) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function sanitizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function getDeductionRate(years) {
  if (years >= 15) {
    return "30%";
  }
  if (years >= 10) {
    return "20%";
  }
  if (years >= 5) {
    return "10%";
  }
  return "0%";
}

function updateMap() {
  const query = address.value.trim();

  if (!query) {
    mapFrame.style.display = "none";
    mapFrame.src = "";
    mapEmpty.style.display = "flex";
    return;
  }

  const encodedQuery = encodeURIComponent(query);
  mapFrame.src = `https://maps.google.com/maps?q=${encodedQuery}&z=16&output=embed`;
  mapFrame.style.display = "block";
  mapEmpty.style.display = "none";
}

function getRentRecordsHeading() {
  const buildingName = buildingNameInput.value.trim();
  return buildingName ? `2026년 월세 기록 - ${buildingName}` : "2026년 월세 기록";
}

function formatEducationMonthLabel(monthValue) {
  const [year, month] = monthValue.split("-");
  return `${year}년 ${Number(month)}월`;
}

function shiftEducationMonth(diff) {
  const [year, month] = educationMonth.split("-").map(Number);
  const base = new Date(year, month - 1 + diff, 1);
  educationMonth = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function saveEducationEntries() {
  persistLocalState();
}

function saveAcademies() {
  persistLocalState();
}

function setMemoFieldValue(input, rawValue) {
  input.value = rawValue || "";
  input.dataset.payer = "";
  const choices = document.querySelectorAll(`.memo-choice[data-target="${input.id}"]`);
  choices.forEach((choice) => choice.classList.remove("active"));
}

function buildMemoValue(input) {
  const payer = input.dataset.payer || "";
  const note = input.value.trim();
  if (payer && note) {
    return `${payer} / ${note}`;
  }
  return payer || note;
}

function toggleMemoChoice(targetId, value) {
  const input = document.getElementById(targetId);
  if (!input) {
    return;
  }

  const nextValue = input.dataset.payer === value ? "" : value;
  input.dataset.payer = nextValue;
  document.querySelectorAll(`.memo-choice[data-target="${targetId}"]`).forEach((choice) => {
    choice.classList.toggle("active", choice.dataset.value === nextValue);
  });
}

function setEducationSubsectionCollapsed(sectionName, collapsed) {
  if (sectionName === "academy") {
    academySectionCollapsed = collapsed;
    academySectionBody.classList.toggle("hidden", collapsed);
    toggleAcademySectionButton.innerText = collapsed ? "입력 열기" : "입력 접기";
    return;
  }

  if (sectionName === "direct") {
    directEducationSectionCollapsed = collapsed;
    directEducationSectionBody.classList.toggle("hidden", collapsed);
    toggleDirectEducationSectionButton.innerText = collapsed ? "입력 열기" : "입력 접기";
  }
}

function setQuickAcademyDetailsCollapsed(collapsed) {
  quickAcademyDetailsCollapsed = collapsed;
  academyQuickDetails.classList.toggle("hidden", collapsed);
  toggleQuickAcademyDetailsButton.innerText = collapsed ? "세부 열기" : "세부 접기";
}

function setChildManagerCollapsed(collapsed) {
  childManagerCollapsed = collapsed;
  const body = educationChildManager.querySelector(".education-child-manager-body");
  const button = educationChildManager.querySelector(".education-child-toggle");
  if (body) {
    body.classList.toggle("hidden", collapsed);
  }
  if (button) {
    button.innerText = collapsed ? "열기" : "접기";
  }
}

function populateChildSelect(selectElement, selectedValue) {
  if (!selectElement) {
    return;
  }

  const fallbackValue = childProfiles[0]?.id || "child1";
  const nextValue = childProfiles.some((profile) => profile.id === selectedValue) ? selectedValue : fallbackValue;

  selectElement.innerHTML = childProfiles.map((profile) => `
    <option value="${profile.id}">${profile.name}</option>
  `).join("");
  selectElement.value = nextValue;
}

function populateChildSelects() {
  populateChildSelect(academyChild, academyChild.value);
  populateChildSelect(educationChild, educationChild.value);
}

function renderChildManager() {
  educationChildManager.innerHTML = `
    <div class="education-child-manager-head">
      <div class="education-child-manager-title">자녀관리</div>
      <button type="button" class="collapse-toggle education-child-toggle">${childManagerCollapsed ? "열기" : "접기"}</button>
    </div>
    <div class="education-child-manager-body${childManagerCollapsed ? " hidden" : ""}">
      <div class="education-child-body-actions">
        <button type="button" class="education-child-add" id="addChildProfileButton">자녀 추가</button>
      </div>
      <div class="education-child-list">
      ${childProfiles.map((profile, index) => `
        <div class="education-child-row">
          <div class="education-child-order">자녀 ${index + 1}</div>
          <input
            type="text"
            value="${profile.name.replace(/"/g, "&quot;")}"
            data-child-profile-id="${profile.id}"
            class="child-profile-name-input"
            placeholder="자녀 이름"
          >
          <button type="button" class="education-child-remove" data-remove-child-id="${profile.id}" ${childProfiles.length === 1 ? "disabled" : ""}>삭제</button>
        </div>
      `).join("")}
      </div>
    </div>
  `;
}

function updateChildProfileName(childId, nextName) {
  childProfiles = childProfiles.map((profile) => (
    profile.id === childId
      ? { ...profile, name: nextName.trim() || profile.name }
      : profile
  ));
  persistLocalState();
  renderEducationTab();
  renderDashboardTab();
}

function addChildProfile() {
  const nextIndex = childProfiles.length + 1;
  childProfiles.push({
    id: `child_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    name: `자녀${nextIndex}`
  });
  persistLocalState();
  renderEducationTab();
  renderDashboardTab();
}

function removeChildProfile(childId) {
  const target = getChildProfile(childId);
  if (!target) {
    return;
  }

  const relatedAcademies = academies.filter((academy) => academy.child === childId).length;
  const relatedEntries = educationEntries.filter((entry) => entry.child === childId).length;
  const relatedCount = relatedAcademies + relatedEntries;
  const warning = relatedCount > 0
    ? `\n이 자녀에 연결된 학원/교육비 기록 ${relatedCount}건도 함께 삭제됩니다.`
    : "";

  if (!window.confirm(`${target.name} 정보를 삭제할까요?${warning}`)) {
    return;
  }

  childProfiles = childProfiles.filter((profile) => profile.id !== childId);
  academies = academies.filter((academy) => academy.child !== childId);
  educationEntries = educationEntries.filter((entry) => entry.child !== childId);
  if (selectedAcademyId) {
    const selectedAcademy = academies.find((academy) => academy.id === selectedAcademyId);
    if (!selectedAcademy) {
      selectedAcademyId = "";
    }
  }
  persistLocalState();
  renderEducationTab();
  renderDashboardTab();
}

function getFilteredEducationEntries() {
  return educationEntries.filter((entry) => {
    if (entry.month !== educationMonth) {
      return false;
    }
    if (educationCategoryFilter !== "all" && entry.category !== educationCategoryFilter) {
      return false;
    }
    return true;
  });
}

function getEducationMonthEntries() {
  return educationEntries.filter((entry) => entry.month === educationMonth);
}

function getCurrentDashboardMonth() {
  const [year, month] = dashboardMonth.split("-").map(Number);
  const now = new Date(year, month - 1, 1);
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, "0"),
    label: `${now.getFullYear()}년 ${now.getMonth() + 1}월`
  };
}

function shiftDashboardMonth(diff) {
  const [year, month] = dashboardMonth.split("-").map(Number);
  const base = new Date(year, month - 1 + diff, 1);
  dashboardMonth = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function renderDashboardTab() {
  const { year, month, label } = getCurrentDashboardMonth();
  const educationMonthKey = `${year}-${month}`;
  const monthEntries = educationEntries.filter((entry) => entry.month === educationMonthKey);
  const childTotals = childProfiles.map((profile) => ({
    ...profile,
    total: monthEntries
      .filter((entry) => entry.child === profile.id)
      .reduce((sum, entry) => sum + parseNumber(entry.amount), 0)
  }));
  const educationTotal = childTotals.reduce((sum, item) => sum + item.total, 0);

  const buildingSummaries = buildings.map((building, index) => {
    const roomRecords = building.rentRecords?.[year] || {};
    const rentIncome = Object.values(roomRecords).reduce((sum, roomRecord) => {
      const monthRecord = roomRecord?.[month];
      const amount = typeof monthRecord === "object" && monthRecord !== null ? monthRecord.amount : monthRecord;
      return sum + parseNumber(amount);
    }, 0);
    const loanInterest = parseNumber(building.rentExpenses?.[year]?.[month]);

    return {
      name: building.name || `건물${index + 1}`,
      rentIncome,
      loanInterest,
      net: rentIncome - loanInterest
    };
  });

  const rentalIncome = buildingSummaries.reduce((sum, item) => sum + item.rentIncome, 0);
  const loanInterestTotal = buildingSummaries.reduce((sum, item) => sum + item.loanInterest, 0);
  const rentalNet = rentalIncome - loanInterestTotal;
  const finalNet = rentalNet - educationTotal;

  dashboardMonthToolbarLabel.innerText = label;
  dashboardMonthLabel.innerText = `${label} 요약`;
  dashboardNetFlow.innerText = formatCurrency(finalNet);
  dashboardRentalNet.innerText = formatCurrency(rentalNet);
  dashboardEducationTotal.innerText = formatCurrency(educationTotal);
  dashboardRentIncome.innerText = formatCurrency(rentalIncome);
  dashboardLoanInterest.innerText = formatCurrency(loanInterestTotal);
  dashboardEducationOverview.innerHTML = childTotals.slice(0, 3).map((item) => `
    <div class="summary-card">${item.name} 교육비<span>${formatCurrency(item.total)}</span></div>
  `).join("");

  dashboardBuildingList.innerHTML = buildingSummaries.length === 0
    ? '<div class="education-empty">등록된 건물이 없습니다.</div>'
    : buildingSummaries.map((item) => `
        <div class="dashboard-building-item">
          <div class="dashboard-building-top">
            <div class="dashboard-building-name">${item.name}</div>
            <div class="dashboard-building-amount">${formatCurrency(item.net)}</div>
          </div>
          <div class="dashboard-building-meta">
            <span>월세 수입 ${formatCurrency(item.rentIncome)}</span>
            <span>대출이자 ${formatCurrency(item.loanInterest)}</span>
          </div>
        </div>
      `).join("");

  dashboardEducationList.innerHTML = `
    ${childTotals.map((item) => `
      <div class="dashboard-education-item">
        <div class="dashboard-education-top">
          <div class="dashboard-education-name">${item.name}</div>
          <div class="dashboard-education-amount">${formatCurrency(item.total)}</div>
        </div>
        <div class="dashboard-education-meta">
          <span>${label} 교육비 합계</span>
        </div>
      </div>
    `).join("")}
    <div class="dashboard-education-item">
      <div class="dashboard-education-top">
        <div class="dashboard-education-name">전체 교육비</div>
        <div class="dashboard-education-amount">${formatCurrency(educationTotal)}</div>
      </div>
      <div class="dashboard-education-meta">
        <span>등록된 자녀 전체</span>
      </div>
    </div>
  `;
}

function renderEducationTab() {
  educationMonthLabel.innerText = formatEducationMonthLabel(educationMonth);
  populateChildSelects();
  renderChildManager();
  const monthEntries = getEducationMonthEntries();
  const filteredEntries = getFilteredEducationEntries().sort((a, b) => a.date.localeCompare(b.date));
  const childSummaries = childProfiles.map((profile) => ({
    ...profile,
    entries: filteredEntries.filter((entry) => entry.child === profile.id),
    total: monthEntries
      .filter((entry) => entry.child === profile.id)
      .reduce((sum, entry) => sum + parseNumber(entry.amount), 0)
  }));
  const grandTotal = childSummaries.reduce((sum, item) => sum + item.total, 0);

  educationTotalAmount.innerText = formatCurrency(grandTotal);
  educationChildSummaryCards.innerHTML = childSummaries.map((item) => `
    <div class="summary-card">${item.name}<span>${formatCurrency(item.total)}</span></div>
  `).join("");
  educationMonthTotalCards.innerHTML = childSummaries.map((item) => `
    <div class="summary-card">${item.name} 합계<span>${formatCurrency(item.total)}</span></div>
  `).join("");
  educationGrandTotal.innerText = formatCurrency(grandTotal);
  setQuickAcademyDetailsCollapsed(quickAcademyDetailsCollapsed);
  setEducationSubsectionCollapsed("academy", academySectionCollapsed);
  setEducationSubsectionCollapsed("direct", directEducationSectionCollapsed);
  renderAcademyList();
  populateAcademyQuickSelect();

  educationColumns.innerHTML = `
    <div class="education-columns">
      ${childSummaries.map((item) => renderEducationColumn(item.name, item.entries)).join("")}
    </div>
  `;
  renderEducationYearlyTable();
}

function renderAcademyList() {
  if (academies.length === 0) {
    academyList.innerHTML = '<div class="education-empty">등록된 학원이 없습니다.</div>';
    return;
  }

  const groups = childProfiles.map((profile, index) => {
    const childAcademies = academies.filter((academy) => academy.child === profile.id);
    if (childAcademies.length === 0) {
      return "";
    }

    return `
      <div class="academy-group">
        <div class="academy-group-title">${profile.name}</div>
        <div class="academy-group-items">
          ${childAcademies.map((academy) => `
            <div class="academy-item ${index % 2 === 0 ? "child1" : "child2"}">
              <div class="academy-item-main">
                <div class="academy-item-title">${academy.name}</div>
                <div class="academy-item-meta">${academy.category} · ${formatCurrency(parseNumber(academy.amount))} · 매월 ${academy.dueDay || "-"}일</div>
              </div>
              <div class="academy-item-actions">
                <button type="button" class="academy-action-button delete" data-academy-id="${academy.id}">삭제</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  academyList.innerHTML = groups;
}

function populateAcademyQuickSelect() {
  if (academies.length === 0) {
    academyQuickButtons.innerHTML = '<div class="education-empty">선택할 학원이 없습니다.</div>';
  } else {
    academyQuickButtons.innerHTML = childProfiles.map((profile, index) => {
      const childAcademies = academies.filter((academy) => academy.child === profile.id);
      if (childAcademies.length === 0) {
        return "";
      }

        return `
        <div class="academy-quick-group">
          <div class="academy-group-title">${profile.name}</div>
          <div class="academy-quick-row">
            <div class="academy-quick-group-items">
              ${childAcademies.map((academy) => `
                <button
                  type="button"
                  class="academy-quick-button ${index % 2 === 0 ? "child1" : "child2"}${academy.id === selectedAcademyId ? " active" : ""}"
                  data-academy-id="${academy.id}"
                >
                  ${academy.name}
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  if (!academies.some((academy) => academy.id === selectedAcademyId)) {
    selectedAcademyId = "";
  }
  fillQuickAcademyForm();
}

function fillQuickAcademyForm() {
  const academy = academies.find((item) => item.id === selectedAcademyId);
  academyQuickChild.value = academy ? getChildName(academy.child) : "";
  academyQuickCategory.value = academy?.category || "";
  academyQuickTitle.value = academy?.name || "";
  academyQuickAmount.value = academy ? formatInputNumber(academy.amount) : "";
  if (!academyQuickDate.value) {
    academyQuickDate.value = getTodayShortDate();
  }
  setMemoFieldValue(academyQuickMemo, "");
}

function resetAcademyForm() {
  academyChild.value = childProfiles[0]?.id || "";
  academyCategory.value = "학원비";
  academyName.value = "";
  academyAmount.value = "";
  academyDueDay.value = "";
  setMemoFieldValue(academyMemo, "");
}

function addAcademy() {
  const name = academyName.value.trim();
  const amount = formatInputNumber(academyAmount.value);

  if (!name || !amount) {
    window.alert("학원명과 기본금액을 입력해 주세요.");
    return;
  }

  academies.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    child: academyChild.value,
    category: academyCategory.value,
    name,
    amount,
    dueDay: academyDueDay.value.trim(),
    memo: buildMemoValue(academyMemo)
  });
  saveAcademies();
  resetAcademyForm();
  renderEducationTab();
}

function deleteAcademy(academyId) {
  const academy = academies.find((item) => item.id === academyId);
  if (!academy) {
    return;
  }

  if (!window.confirm(`${getChildName(academy.child)}의 ${academy.name} 학원 정보를 삭제할까요?`)) {
    return;
  }

  academies = academies.filter((item) => item.id !== academyId);
  saveAcademies();
  renderEducationTab();
}

function renderEducationColumn(childLabel, entries) {
  const total = entries.reduce((sum, entry) => sum + parseNumber(entry.amount), 0);
  const listHtml = entries.length === 0
    ? `<div class="education-empty">${childLabel} 기록이 없습니다.</div>`
    : `<div class="education-list">${entries.map((entry) => `
        <div class="education-item">
          <div class="education-item-top">
            <span>${entry.date || "-"}</span>
            <span>${entry.category}</span>
          </div>
          <div class="education-item-main">
            <div class="education-item-title">${entry.title || "-"}</div>
            <div class="education-item-amount">${formatCurrency(parseNumber(entry.amount))}</div>
          </div>
          ${entry.memo ? `<div class="education-item-memo">${entry.memo}</div>` : ""}
          <div class="education-item-actions">
            <button type="button" class="education-delete-button" data-entry-id="${entry.id}">삭제</button>
          </div>
        </div>
      `).join("")}</div>`;

  return `
    <div class="education-column">
      <div class="education-column-header">
        <div class="education-column-title">${childLabel}</div>
        <div class="education-column-total">${formatCurrency(total)}</div>
      </div>
      ${listHtml}
    </div>
  `;
}

function renderEducationYearlyTable() {
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
  const rows = months.map((month) => {
    const childCells = childProfiles.map((profile) => {
      const total = educationEntries
        .filter((entry) => entry.month === `2026-${month}` && entry.child === profile.id)
        .reduce((sum, entry) => sum + parseNumber(entry.amount), 0);
      return `<td>${formatCurrency(total)}</td>`;
    }).join("");
    return `<tr><td>${Number(month)}월</td>${childCells}</tr>`;
  }).join("");

  const totalCells = childProfiles.map((profile) => {
    const total = educationEntries
      .filter((entry) => entry.child === profile.id && entry.month.startsWith("2026-"))
      .reduce((sum, entry) => sum + parseNumber(entry.amount), 0);
    return `<td>${formatCurrency(total)}</td>`;
  }).join("");

  educationYearlyTable.innerHTML = `
    <div class="education-yearly-wrap">
      <table class="education-yearly-table">
        <colgroup>
          <col style="width: 84px;">
          ${childProfiles.map(() => '<col>')}
        </colgroup>
        <thead>
          <tr>
            <th>월</th>
            ${childProfiles.map((profile) => `<th>${profile.name}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="year-total-row">
            <td>합계</td>
            ${totalCells}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function deleteEducationEntry(entryId) {
  const target = educationEntries.find((entry) => entry.id === entryId);
  if (!target) {
    return;
  }

  if (!window.confirm(`${getChildName(target.child)}의 ${target.title || target.category} 기록을 삭제할까요?`)) {
    return;
  }

  educationEntries = educationEntries.filter((entry) => entry.id !== entryId);
  saveEducationEntries();
  renderEducationTab();
}

function resetEducationEntryForm() {
  educationChild.value = childProfiles[0]?.id || "";
  educationCategory.value = "교재비";
  educationTitle.value = "";
  educationAmount.value = "";
  educationDate.value = "";
  setMemoFieldValue(educationMemo, "");
}

function addEducationEntry() {
  const amount = formatInputNumber(educationAmount.value);
  const title = educationTitle.value.trim();

  if (!title || !amount) {
    window.alert("내용과 금액을 입력해 주세요.");
    return;
  }

  educationEntries.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    month: educationMonth,
    child: educationChild.value,
    category: educationCategory.value,
    title,
    amount,
    date: formatShortDateInput(educationDate.value),
    memo: buildMemoValue(educationMemo)
  });

  saveEducationEntries();
  resetEducationEntryForm();
  renderEducationTab();
}

function addQuickAcademyEntry() {
  const academy = academies.find((item) => item.id === selectedAcademyId);
  if (!academy) {
    window.alert("등록된 학원을 선택해 주세요.");
    return;
  }

  educationEntries.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    month: educationMonth,
    child: academy.child,
    category: academy.category,
    title: academy.name,
    amount: formatInputNumber(academyQuickAmount.value || academy.amount),
    date: formatShortDateInput(academyQuickDate.value),
    memo: buildMemoValue(academyQuickMemo) || academy.memo || ""
  });

  saveEducationEntries();
  academyQuickDate.value = "";
  setMemoFieldValue(academyQuickMemo, "");
  renderEducationTab();
}

function setAppTab(tabName) {
  currentAppTab = tabName;
  localStorage.setItem(appTabStorageKey, tabName);

  document.querySelectorAll(".app-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  rentalSection.classList.toggle("hidden", tabName !== "rental");
  educationSection.classList.toggle("hidden", tabName !== "education");
  dashboardSection.classList.toggle("hidden", tabName !== "dashboard");
  reportSection.classList.toggle("hidden", tabName !== "report");

  if (tabName === "education") {
    renderEducationTab();
  }

  if (tabName === "dashboard") {
    renderDashboardTab();
  }
}

function updateHoldingInfo() {
  if (!buyDate.value) {
    holdYears.innerText = "-";
    return;
  }

  const buy = new Date(buyDate.value);
  const today = new Date();
  const diffMs = today - buy;

  if (Number.isNaN(diffMs) || diffMs < 0) {
    holdYears.innerText = "-";
    return;
  }

  const years = diffMs / (1000 * 60 * 60 * 24 * 365.25);
  holdYears.innerText = `${years.toFixed(1)}년`;
}

function renderTabs() {
  normalizeBuildingsState();
  tabs.innerHTML = "";

  buildings.forEach((building, index) => {
    const button = document.createElement("button");
    button.innerText = building.name || `건물${index + 1}`;
    if (index === current) {
      button.classList.add("active");
    }
    button.onclick = () => {
      save();
      current = index;
      load();
    };
    tabs.appendChild(button);
  });

  const add = document.createElement("button");
  add.innerText = "+";
  add.onclick = () => {
    save();
    buildings.push(newBuilding());
    current = buildings.length - 1;
    load();
  };
  tabs.appendChild(add);
  deleteBuildingButton.innerText = buildings.length > 1 ? "현재 건물 삭제" : "현재 건물 비우기";
  moveBuildingLeftButton.disabled = current <= 0;
  moveBuildingRightButton.disabled = current >= buildings.length - 1;
}

function getRoomLabels() {
  if (buildingType.value === "apartment") {
    return [getApartmentRoomLabel()];
  }

  const labels = [];

  [f1, f2, f3, f4, f5].forEach((floorField, floorIndex) => {
    const count = parseNumber(floorField.value);
    buildFloorRoomNumbers(floorIndex, count).forEach((roomNumber) => {
      labels.push(`${roomNumber}호`);
    });
  });

  return labels;
}

function parseExcludedRooms(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  );
}

function buildFloorRoomNumbers(floorIndex, count) {
  const excludeInputs = [x1, x2, x3, x4, x5];
  const excludes = parseExcludedRooms(excludeInputs[floorIndex]?.value);
  const roomNumbers = [];
  let candidate = 1;

  while (roomNumbers.length < count) {
    if (!excludes.has(candidate)) {
      roomNumbers.push((floorIndex + 1) * 100 + candidate);
    }
    candidate += 1;
  }

  return roomNumbers;
}

function collectRoomsFromDom() {
  return Array.from(document.querySelectorAll(".room")).map((room) => ({
    j: room.querySelector(".j").checked,
    w: room.querySelector(".w").checked,
    v: room.querySelector(".v").checked,
    expanded: !room.classList.contains("is-compact"),
    d: formatInputNumber(room.querySelector(".d").value),
    m: formatInputNumber(room.querySelector(".m").value),
    tenantName: room.querySelector(".tenant-name").value,
    tenantPhone: room.querySelector(".tenant-phone").value,
    moveIn: room.querySelector(".move-in").value,
    moveOut: room.querySelector(".move-out").value,
    note: room.querySelector(".note").value
  }));
}

function isMeaningfulBuilding(building) {
  if (!building || typeof building !== "object") {
    return false;
  }

  const hasRooms = Array.isArray(building.rooms) && building.rooms.some((room) => (
    room && (
      room.tenantName ||
      room.tenantPhone ||
      parseNumber(room.d) ||
      parseNumber(room.m) ||
      room.note ||
      room.moveIn ||
      room.moveOut
    )
  ));

  return Boolean(
    String(building.name || "").trim() ||
    String(building.address || "").trim() ||
    String(building.apartmentDong || "").trim() ||
    String(building.apartmentHo || "").trim() ||
    parseNumber(building.price) ||
    parseNumber(building.loan) ||
    hasRooms
  );
}

function normalizeBuildingsState() {
  const hasMeaningfulBuilding = buildings.some((building) => isMeaningfulBuilding(building));
  if (hasMeaningfulBuilding) {
    buildings = buildings.filter((building, index) => (
      index === current || isMeaningfulBuilding(building)
    ));
  }
  if (buildings.length === 0) {
    buildings = [newBuilding()];
  }
  current = Math.min(current, buildings.length - 1);
}

function formatNumericInputs() {
  document.querySelectorAll(".num, .d, .m").forEach((input) => {
    if (document.activeElement !== input) {
      input.value = formatInputNumber(input.value);
    }
  });
}

function save() {
  const building = buildings[current];

  building.name = buildingNameInput.value;
  building.address = address.value;
  building.buildingType = buildingType.value;
  building.apartmentDong = apartmentDong.value;
  building.apartmentHo = apartmentHo.value;
  building.price = price.value;
  building.loan = loan.value;
  building.rate = rate.value;
  building.buyDate = buyDate.value;
  building.floors = [f1.value, f2.value, f3.value, f4.value, f5.value];
  building.floorExcludes = [x1.value, x2.value, x3.value, x4.value, x5.value];
  building.floorCollapsed = [0, 1, 2, 3, 4].map((index) => {
    const floorBox = document.querySelector(`.floor-box[data-floor="${index}"]`);
    return floorBox ? floorBox.classList.contains("is-collapsed") : Boolean(building.floorCollapsed?.[index]);
  });
  building.propertyDetailsCollapsed = propertyDetails.classList.contains("collapsed");
  building.floorSettingsCollapsed = floorSettings.classList.contains("collapsed");
  building.rentRecords = building.rentRecords || {};
  building.rooms = collectRoomsFromDom();

  persistLocalState();
  calcPortfolio();
  renderTabs();
  renderDashboardTab();
}

function load() {
  normalizeBuildingsState();
  const building = buildings[current];

  buildingNameInput.value = building.name;
  address.value = building.address;
  buildingType.value = building.buildingType || "multi";
  apartmentDong.value = building.apartmentDong || "";
  apartmentHo.value = building.apartmentHo || "";
  price.value = formatInputNumber(building.price);
  loan.value = formatInputNumber(building.loan);
  rate.value = building.rate;
  buyDate.value = building.buyDate;

  [f1, f2, f3, f4, f5].forEach((field, index) => {
    field.value = building.floors[index];
  });
  [x1, x2, x3, x4, x5].forEach((field, index) => {
    field.value = building.floorExcludes?.[index] || "";
  });

  setPropertyDetailsCollapsed(true);
  setFloorSettingsCollapsed(true);
  updateBuildingTypeUi();

  generate(false);

  document.querySelectorAll(".room").forEach((room, index) => {
    const roomData = building.rooms[index];
    if (!roomData) {
      return;
    }

    room.querySelector(".j").checked = roomData.j;
    room.querySelector(".w").checked = roomData.w;
    room.querySelector(".v").checked = Boolean(roomData.v);
    room.querySelector(".d").value = formatInputNumber(roomData.d);
    room.querySelector(".m").value = formatInputNumber(roomData.m);
    room.querySelector(".tenant-name").value = roomData.tenantName || "";
    room.querySelector(".tenant-phone").value = roomData.tenantPhone || "";
    room.querySelector(".move-in").value = roomData.moveIn || "";
    room.querySelector(".move-out").value = roomData.moveOut || "";
    room.querySelector(".note").value = roomData.note || "";
    room.querySelector(".m").disabled = roomData.j || roomData.v;
  });

  formatNumericInputs();
  updateHoldingInfo();
  updateMap();
  calc();
  renderRentRecords();
  renderTabs();
  renderDashboardTab();
}

function createRoomCard(roomLabel, roomState) {
  const isJeonse = Boolean(roomState.j);
  const isVacant = Boolean(roomState.v);
  const isMonthly = roomState.w !== undefined ? Boolean(roomState.w) : (!isJeonse && !isVacant);
  const isCompact = roomState.expanded !== true;
  const roomStatusLabel = getRoomStatusLabel(isJeonse, isVacant);
  const roomStatusClass = getRoomStatusClass(isJeonse, isVacant);
  const card = document.createElement("div");
  card.className = `room${isCompact ? " is-compact" : ""}`;
  card.innerHTML = `
    <div class="room-head">
      <div class="room-title-wrap">
        <div class="room-title">${roomLabel}</div>
        <div class="room-status-badge ${roomStatusClass}">(${roomStatusLabel})</div>
      </div>
      <div class="room-actions">
        <div class="phone-actions">
          <a class="phone-action phone-call is-disabled" href="#" tabindex="-1">전화</a>
          <a class="phone-action phone-sms is-disabled" href="#" tabindex="-1">문자</a>
        </div>
        <button type="button" class="room-toggle">${isCompact ? "상세보기" : "닫기"}</button>
      </div>
    </div>
    <div class="room-top">
      <div class="mini-row">
        <label>이름</label>
        <input class="tenant-name" value="${roomState.tenantName || ""}">
      </div>
      <div class="mini-row">
        <label>전화</label>
        <input class="tenant-phone" value="${roomState.tenantPhone || ""}">
      </div>
    </div>
    <div class="room-grid">
      <div class="mini-row">
        <label>보증금</label>
        <input class="d" value="${formatInputNumber(roomState.d)}">
      </div>
      <div class="mini-row">
        <label>월세</label>
        <input class="m" value="${formatInputNumber(roomState.m)}" ${(isJeonse || isVacant) ? "disabled" : ""}>
      </div>
    </div>
    <div class="room-details">
      <div class="room-type-controls">
        <label class="room-type-chip"><input type="checkbox" class="j" ${isJeonse ? "checked" : ""}> 전세</label>
        <label class="room-type-chip"><input type="checkbox" class="w" ${isMonthly ? "checked" : ""}> 월세</label>
        <label class="room-type-chip"><input type="checkbox" class="v" ${isVacant ? "checked" : ""}> 공실</label>
      </div>
      <div class="room-grid room-grid-detail">
      <div class="mini-row">
        <label>입주일</label>
        <input type="date" class="move-in" value="${roomState.moveIn || ""}">
      </div>
      <div class="mini-row">
        <label>퇴실일</label>
        <input type="date" class="move-out" value="${roomState.moveOut || ""}">
      </div>
      </div>
      <div class="room-note">
        <label>특이사항</label>
        <textarea class="note" rows="3">${roomState.note || ""}</textarea>
      </div>
    </div>
  `;
  return card;
}

function generate(preserveCurrentDom = true) {
  const existingRooms = preserveCurrentDom ? collectRoomsFromDom() : [];
  const currentFloorCollapsed = [0, 1, 2, 3, 4].map((index) => {
    const floorBox = document.querySelector(`.floor-box[data-floor="${index}"]`);
    if (floorBox) {
      return floorBox.classList.contains("is-collapsed");
    }
    return Boolean(buildings[current].floorCollapsed?.[index]);
  });

  rooms.innerHTML = "";

  if (buildingType.value === "apartment") {
    const box = document.createElement("div");
    box.className = "floor-box";
    box.innerHTML = `
      <div class="floor-box-head">
        <div class="floor-header">아파트 임대 정보</div>
      </div>
    `;
    const wrap = document.createElement("div");
    wrap.className = "rooms";
    const roomState = preserveCurrentDom
      ? (buildings[current].rooms[0] || existingRooms[0] || {})
      : (buildings[current].rooms[0] || {});
    wrap.appendChild(createRoomCard(getApartmentRoomLabel(), roomState));
    box.appendChild(wrap);
    rooms.appendChild(box);
    bind();
    bindFloorToggles();
    calc();
    renderRentRecords();
    return;
  }

  [f1, f2, f3, f4, f5].forEach((floorField, floorIndex) => {
    const count = parseNumber(floorField.value);
    if (!count) {
      return;
    }
    const floorRoomNumbers = buildFloorRoomNumbers(floorIndex, count);

    const box = document.createElement("div");
    box.className = "floor-box";
    box.dataset.floor = String(floorIndex);
    if (currentFloorCollapsed[floorIndex]) {
      box.classList.add("is-collapsed");
    }
    box.innerHTML = `
      <div class="floor-box-head">
        <div class="floor-header">${floorIndex + 1}층 호실</div>
      </div>
    `;

    const wrap = document.createElement("div");
    wrap.className = "rooms";

    for (let roomNumber = 0; roomNumber < floorRoomNumbers.length; roomNumber += 1) {
      const roomIndex = wrap.childElementCount + Array.from(rooms.children).reduce((sum, child) => {
        const list = child.querySelector(".rooms");
        return sum + (list ? list.childElementCount : 0);
      }, 0);
      const roomState = preserveCurrentDom
        ? (buildings[current].rooms[roomIndex] || existingRooms[roomIndex] || {})
        : (buildings[current].rooms[roomIndex] || {});
      wrap.appendChild(createRoomCard(`${floorRoomNumbers[roomNumber]}호`, roomState));
    }

    box.appendChild(wrap);
    rooms.appendChild(box);
  });

  bind();
  bindFloorToggles();
  calc();
  renderRentRecords();
}

function bindFloorToggles() {
  document.querySelectorAll(".floor-box").forEach((floorBox) => {
    const header = floorBox.querySelector(".floor-header");
    if (!header) {
      return;
    }

    header.onclick = () => {
      floorBox.classList.toggle("is-collapsed");
      save();
    };
  });
}

function bind() {
  document.querySelectorAll(".room").forEach((room) => {
    const jeonse = room.querySelector(".j");
    const monthly = room.querySelector(".w");
    const vacant = room.querySelector(".v");
    const monthlyRent = room.querySelector(".m");
    const roomToggle = room.querySelector(".room-toggle");
    const roomTitle = room.querySelector(".room-title")?.innerText || "호실";
    const roomStatusBadge = room.querySelector(".room-status-badge");
    const tenantPhone = room.querySelector(".tenant-phone");
    const phoneCall = room.querySelector(".phone-call");
    const phoneSms = room.querySelector(".phone-sms");

      const updateRoomStatusBadge = () => {
        if (!roomStatusBadge) {
          return;
        }
        const nextLabel = getRoomStatusLabel(jeonse.checked, vacant.checked);
        roomStatusBadge.innerText = `(${nextLabel})`;
        roomStatusBadge.classList.remove("state-jeonse", "state-monthly", "state-vacant");
        roomStatusBadge.classList.add(getRoomStatusClass(jeonse.checked, vacant.checked));
      };

    const updatePhoneActions = () => {
      const phone = sanitizePhoneNumber(tenantPhone?.value);
      const enabled = phone.length >= 9;

      [phoneCall, phoneSms].forEach((link) => {
        if (!link) {
          return;
        }
        link.classList.toggle("is-disabled", !enabled);
        link.tabIndex = enabled ? 0 : -1;
      });

      if (phoneCall) {
        phoneCall.href = enabled ? `tel:${phone}` : "#";
      }

      if (phoneSms) {
        phoneSms.href = enabled ? `sms:${phone}` : "#";
      }
    };

    if (roomToggle) {
      roomToggle.onclick = () => {
        const compact = room.classList.toggle("is-compact");
        roomToggle.innerText = compact ? "상세보기" : "닫기";
        save();
      };
    }

    const previousState = {
      j: jeonse.checked,
      w: monthly.checked,
      v: vacant.checked
    };

    const restorePreviousState = () => {
      jeonse.checked = previousState.j;
      monthly.checked = previousState.w;
      vacant.checked = previousState.v;
      monthlyRent.disabled = previousState.j || previousState.v;
      updateRoomStatusBadge();
    };

    const syncPreviousState = () => {
      previousState.j = jeonse.checked;
      previousState.w = monthly.checked;
      previousState.v = vacant.checked;
    };

    const confirmRoomTypeChange = (nextLabel) => {
      const currentLabel = previousState.v ? "공실" : previousState.j ? "전세" : "월세";
      return window.confirm(`${roomTitle} 상태를 ${currentLabel}에서 ${nextLabel}(으)로 변경할까요?`);
    };

    jeonse.onclick = () => {
      if (jeonse.checked && !previousState.j && !confirmRoomTypeChange("전세")) {
        restorePreviousState();
        return;
      }

      if (jeonse.checked) {
        monthly.checked = false;
        vacant.checked = false;
        monthlyRent.value = "";
        monthlyRent.disabled = true;
      } else {
        if (!vacant.checked) {
          monthly.checked = true;
          monthlyRent.disabled = false;
        }
      }
      syncPreviousState();
      updateRoomStatusBadge();
      calc();
      save();
    };

    monthly.onclick = () => {
      if (monthly.checked && !previousState.w && !confirmRoomTypeChange("월세")) {
        restorePreviousState();
        return;
      }

      if (monthly.checked) {
        jeonse.checked = false;
        vacant.checked = false;
        monthlyRent.disabled = false;
      } else {
        if (!vacant.checked) {
          jeonse.checked = true;
          monthlyRent.value = "";
          monthlyRent.disabled = true;
        }
      }
      syncPreviousState();
      updateRoomStatusBadge();
      calc();
      save();
    };

    vacant.onclick = () => {
      if (vacant.checked && !previousState.v && !confirmRoomTypeChange("공실")) {
        restorePreviousState();
        return;
      }

      if (vacant.checked) {
        jeonse.checked = false;
        monthly.checked = false;
        monthlyRent.value = "";
        monthlyRent.disabled = true;
      } else {
        monthly.checked = true;
        monthlyRent.disabled = false;
      }
      syncPreviousState();
      updateRoomStatusBadge();
      calc();
      save();
    };

    updateRoomStatusBadge();
    updatePhoneActions();

    tenantPhone?.addEventListener("input", () => {
      updatePhoneActions();
    });
  });
}

function calc() {
  let rent = 0;
  let deposit = 0;

  formatNumericInputs();

  document.querySelectorAll(".room").forEach((room) => {
    deposit += parseNumber(room.querySelector(".d").value);

    if (room.querySelector(".w").checked) {
      rent += parseNumber(room.querySelector(".m").value);
    }
  });

  depositSum.innerText = formatCurrency(deposit);
  rentSum.innerText = formatCurrency(rent);

  const monthlyInterest = parseNumber(loan.value) * (parseNumber(rate.value) / 100) / 12;
  interest.innerText = formatCurrency(monthlyInterest);
  annualInterest.innerText = formatCurrency(monthlyInterest * 12);
  priceKorean.innerText = formatKoreanCurrencyText(price.value);
  loanKorean.innerText = formatKoreanCurrencyText(loan.value);

  updateHoldingInfo();
  calcPortfolio();
}

function calcPortfolio() {
  let portfolioDeposit = 0;
  let portfolioRent = 0;
  let portfolioLoan = 0;
  let portfolioInterest = 0;
  const portfolioRows = [];

  buildings.forEach((building, index) => {
    const sourceRooms = index === current ? collectRoomsFromDom() : (building.rooms || []);
    const loanAmount = parseNumber(building.loan);
    const rateAmount = parseNumber(building.rate);
    let buildingDeposit = 0;
    let buildingRent = 0;

    portfolioLoan += loanAmount;
    portfolioInterest += loanAmount * (rateAmount / 100) / 12;

    sourceRooms.forEach((room) => {
      const depositAmount = parseNumber(room.d);
      buildingDeposit += depositAmount;
      portfolioDeposit += depositAmount;
      if (room.w) {
        const rentAmount = parseNumber(room.m);
        buildingRent += rentAmount;
        portfolioRent += rentAmount;
      }
    });

    portfolioRows.push({
      name: building.name || `건물${index + 1}`,
      deposit: buildingDeposit,
      rent: buildingRent,
      loan: loanAmount
    });
  });

  const net = portfolioRent - portfolioInterest;

  portfolioList.innerHTML = `
    <div class="portfolio-list">
      <div class="portfolio-row header">
        <div>건물명</div>
        <div>보증금</div>
        <div>월세</div>
        <div>대출</div>
      </div>
      ${portfolioRows.map((row) => `
        <div class="portfolio-row">
          <div class="portfolio-name">${row.name}</div>
          <div>${formatCurrency(row.deposit)}</div>
          <div>${formatCurrency(row.rent)}</div>
          <div>${formatCurrency(row.loan)}</div>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("totalDeposit").innerText = formatCurrency(portfolioDeposit);
  document.getElementById("totalRent").innerText = formatCurrency(portfolioRent);
  document.getElementById("totalLoan").innerText = formatCurrency(portfolioLoan);
  document.getElementById("totalInterest").innerText = formatCurrency(portfolioInterest);
  document.getElementById("totalNet").innerText = formatCurrency(net);
}

function upsertRentRecordAmount(roomLabel, month, amount) {
  const selectedYear = "2026";
  const buildingData = buildings[current];
  const existingRecord = buildingData.rentRecords?.[selectedYear]?.[roomLabel]?.[month];
  const paidDate = typeof existingRecord === "object" && existingRecord !== null ? existingRecord.paidDate : "";

  buildingData.rentRecords = buildingData.rentRecords || {};
  buildingData.rentRecords[selectedYear] = buildingData.rentRecords[selectedYear] || {};
  buildingData.rentRecords[selectedYear][roomLabel] = buildingData.rentRecords[selectedYear][roomLabel] || {};
  buildingData.rentRecords[selectedYear][roomLabel][month] = {
    amount,
    paidDate
  };
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  updateRentRecordMonthTotal(selectedYear, month);
}

function clearRentRecordAmount(roomLabel, month) {
  const selectedYear = "2026";
  const buildingData = buildings[current];
  const existingRecord = buildingData.rentRecords?.[selectedYear]?.[roomLabel]?.[month];
  const paidDate = typeof existingRecord === "object" && existingRecord !== null ? existingRecord.paidDate : "";

  buildingData.rentRecords = buildingData.rentRecords || {};
  buildingData.rentRecords[selectedYear] = buildingData.rentRecords[selectedYear] || {};
  buildingData.rentRecords[selectedYear][roomLabel] = buildingData.rentRecords[selectedYear][roomLabel] || {};
  buildingData.rentRecords[selectedYear][roomLabel][month] = {
    amount: "",
    paidDate
  };
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  updateRentRecordMonthTotal(selectedYear, month);
}

function getMonthlyInterestRecord(year, month) {
  const building = buildings[current];
  return building.rentExpenses?.[year]?.[month] || "";
}

function upsertMonthlyInterest(year, month, amount) {
  const building = buildings[current];
  building.rentExpenses = building.rentExpenses || {};
  building.rentExpenses[year] = building.rentExpenses[year] || {};
  building.rentExpenses[year][month] = amount;
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  updateRentRecordMonthSummary(year, month);
}

function renderRentRecords() {
  const building = buildings[current];
  const year = "2026";
  const hasLoan = parseNumber(building.loan) > 0;
  rentRecordsTitle.innerText = getRentRecordsHeading();
  const roomLabels = getRoomLabels();
  const sourceRooms = collectRoomsFromDom();
  const monthlyRooms = sourceRooms
    .map((room, index) => ({
      label: roomLabels[index],
      room
    }))
    .filter((item) => item.room.w && !item.room.v);

  building.rentRecords = building.rentRecords || {};
  building.rentRecords[year] = building.rentRecords[year] || {};

  if (monthlyRooms.length === 0) {
    rentRecordsContainer.innerHTML = '<div class="rent-records-empty">월세로 설정된 호실이 있으면 1년치 수납 기록을 입력할 수 있습니다.</div>';
    return;
  }

  const monthHeaders = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
  const rows = monthlyRooms.map(({ label, room }) => {
    const baseRent = parseNumber(room.m);
    const yearlyRecord = building.rentRecords[year][label] || {};
    const cells = monthHeaders.map((_, monthIndex) => {
      const key = String(monthIndex + 1).padStart(2, "0");
      const savedRecord = yearlyRecord[key];
      const savedAmount = typeof savedRecord === "object" && savedRecord !== null ? savedRecord.amount : savedRecord;
      const savedPaidDate = typeof savedRecord === "object" && savedRecord !== null ? savedRecord.paidDate : "";
      return `
        <td>
          <div class="rent-record-cell" data-room="${label}" data-month="${key}" data-base-rent="${baseRent}">
            <input class="rent-record-input" data-room="${label}" data-month="${key}" value="${formatInputNumber(savedAmount)}" placeholder="금액">
            <input class="rent-record-date" data-room="${label}" data-month="${key}" value="${formatShortDateInput(savedPaidDate || "")}" placeholder="YY-MM-DD" inputmode="numeric" maxlength="8">
          </div>
        </td>
      `;
    }).join("");
    return `
      <tr>
        <td>
          <div class="rent-room-meta">
            <strong>${label}</strong>
            <span>${formatCurrency(parseNumber(room.m))}</span>
          </div>
        </td>
        ${cells}
      </tr>
    `;
  }).join("");

  const totals = monthHeaders.map((_, monthIndex) => {
    const key = String(monthIndex + 1).padStart(2, "0");
    const total = monthlyRooms.reduce((sum, { label }) => {
      const monthRecord = building.rentRecords[year][label]?.[key];
      const amount = typeof monthRecord === "object" && monthRecord !== null ? monthRecord.amount : monthRecord;
      return sum + parseNumber(amount);
    }, 0);
    return `<td data-total-month="${key}"><b>${formatCurrency(total)}</b></td>`;
  }).join("");

  const interestRow = monthHeaders.map((_, monthIndex) => {
    const key = String(monthIndex + 1).padStart(2, "0");
    return `
      <td>
        <input
          class="rent-interest-input"
          data-month="${key}"
          value="${formatInputNumber(getMonthlyInterestRecord(year, key))}"
          placeholder="이자"
        >
      </td>
    `;
  }).join("");

  const netRow = monthHeaders.map((_, monthIndex) => {
    const key = String(monthIndex + 1).padStart(2, "0");
    const total = monthlyRooms.reduce((sum, { label }) => {
      const monthRecord = building.rentRecords[year][label]?.[key];
      const amount = typeof monthRecord === "object" && monthRecord !== null ? monthRecord.amount : monthRecord;
      return sum + parseNumber(amount);
    }, 0);
    const interest = hasLoan ? parseNumber(getMonthlyInterestRecord(year, key)) : 0;
    return `<td data-net-month="${key}"><b>${formatCurrency(total - interest)}</b></td>`;
  }).join("");

  rentRecordsContainer.innerHTML = `
    <div class="rent-records-table-wrap">
        <table class="rent-records-table">
        <colgroup>
          <col style="width:44px;">
          ${monthHeaders.map(() => '<col style="width:88px;">').join("")}
        </colgroup>
        <thead>
          <tr>
            <th class="rent-room-col">호실</th>
            ${monthHeaders.map((month) => `<th class="rent-month-col">${month}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td><b>합계</b></td>
            ${totals}
          </tr>
          ${hasLoan ? `
          <tr>
            <td><b>대출이자</b></td>
            ${interestRow}
          </tr>
          ` : ""}
          <tr>
            <td><b>순수익</b></td>
            ${netRow}
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(".rent-record-input").forEach((input) => {
    input.addEventListener("input", () => {
      const selectedYear = "2026";
      const roomLabel = input.dataset.room;
      const month = input.dataset.month;
      const formattedValue = formatInputNumber(input.value);
      input.value = formattedValue;
      upsertRentRecordAmount(roomLabel, month, formattedValue);
    });
  });

  document.querySelectorAll(".rent-record-date").forEach((input) => {
    input.addEventListener("input", () => {
      const selectedYear = "2026";
      const roomLabel = input.dataset.room;
      const month = input.dataset.month;
      const buildingData = buildings[current];
      const existingRecord = buildingData.rentRecords?.[selectedYear]?.[roomLabel]?.[month];
      const amount = typeof existingRecord === "object" && existingRecord !== null ? existingRecord.amount : formatInputNumber(existingRecord);
      const formattedDate = formatShortDateInput(input.value);

      buildingData.rentRecords = buildingData.rentRecords || {};
      buildingData.rentRecords[selectedYear] = buildingData.rentRecords[selectedYear] || {};
      buildingData.rentRecords[selectedYear][roomLabel] = buildingData.rentRecords[selectedYear][roomLabel] || {};
      buildingData.rentRecords[selectedYear][roomLabel][month] = {
        amount,
        paidDate: formattedDate
      };
      input.value = formattedDate;
      localStorage.setItem(storageKey, JSON.stringify(buildings));
    });
  });

  document.querySelectorAll(".rent-interest-input").forEach((input) => {
    input.addEventListener("input", () => {
      const month = input.dataset.month;
      const formattedValue = formatInputNumber(input.value);
      input.value = formattedValue;
      upsertMonthlyInterest(year, month, formattedValue);
    });
  });

  document.querySelectorAll(".rent-record-cell").forEach((cell) => {
    const handleCellTap = () => {
      const amountInput = cell.querySelector(".rent-record-input");
      const roomLabel = cell.dataset.room;
      const month = cell.dataset.month;
      const baseRent = formatInputNumber(cell.dataset.baseRent);
      const currentValue = amountInput.value.trim();

      if (currentValue) {
        if (window.confirm(`${roomLabel} ${Number(month)}월 입력 금액을 삭제할까요?`)) {
          amountInput.value = "";
          clearRentRecordAmount(roomLabel, month);
        }
        return;
      }

      if (!baseRent) {
        return;
      }

      if (!window.confirm(`${roomLabel} ${Number(month)}월에 ${baseRent}을 입력할까요?`)) {
        return;
      }

      amountInput.value = baseRent;
      upsertRentRecordAmount(roomLabel, month, baseRent);
    };

    cell.addEventListener("click", (event) => {
      if (event.target.classList.contains("rent-record-date")) {
        return;
      }
      if (event.target.classList.contains("rent-record-input")) {
        event.preventDefault();
      }
      handleCellTap();
    });

    const amountInput = cell.querySelector(".rent-record-input");
    if (amountInput) {
      amountInput.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      amountInput.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleCellTap();
      });
    }
  });
}

function updateRentRecordMonthTotal(year, month) {
  const building = buildings[current];
  const monthTotalCell = document.querySelector(`[data-total-month="${month}"] b`);

  if (!monthTotalCell) {
    return;
  }

  const monthTotal = Object.values(building.rentRecords?.[year] || {}).reduce((sum, roomRecord) => {
    const monthRecord = roomRecord?.[month];
    const amount = typeof monthRecord === "object" && monthRecord !== null ? monthRecord.amount : monthRecord;
    return sum + parseNumber(amount);
  }, 0);

  monthTotalCell.innerText = formatCurrency(monthTotal);
  updateRentRecordMonthSummary(year, month);
}

function updateRentRecordMonthSummary(year, month) {
  const totalCell = document.querySelector(`[data-total-month="${month}"] b`);
  const netCell = document.querySelector(`[data-net-month="${month}"] b`);

  if (!totalCell || !netCell) {
    return;
  }

  const building = buildings[current];
  const monthTotal = Object.values(building.rentRecords?.[year] || {}).reduce((sum, roomRecord) => {
    const monthRecord = roomRecord?.[month];
    const amount = typeof monthRecord === "object" && monthRecord !== null ? monthRecord.amount : monthRecord;
    return sum + parseNumber(amount);
  }, 0);
  const interest = parseNumber(getMonthlyInterestRecord(year, month));

  totalCell.innerText = formatCurrency(monthTotal);
  netCell.innerText = formatCurrency(monthTotal - interest);
}

function printRentRecords() {
  const sourceTable = rentRecordsContainer.querySelector(".rent-records-table");
  const contentWidth = sourceTable ? sourceTable.scrollWidth + 24 : 1100;
  const printableWidth = 1000;
  const printScale = Math.min(1, printableWidth / contentWidth);
  const printHost = document.createElement("div");
  printHost.className = "rent-record-print-root";
  printHost.style.setProperty("--print-content-width", `${contentWidth}px`);
  printHost.style.setProperty("--print-scale", `${printScale}`);
  printHost.innerHTML = `
    <div class="rent-records">
      <div class="rent-records-header">
        <h3 style="margin:0;">${getRentRecordsHeading()}</h3>
      </div>
      ${rentRecordsContainer.outerHTML}
    </div>
  `;

  document.body.appendChild(printHost);
  document.body.classList.add("print-rent-records");
  const cleanup = () => {
    document.body.classList.remove("print-rent-records");
    printHost.remove();
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.print();
}

function exportRentRecordsPdf() {
  const previousTitle = document.title;
  const buildingName = buildingNameInput.value.trim() || "다가구-통합-관리";
  document.title = `${buildingName}-2026년-월세기록`;
  printRentRecords();

  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };

  window.addEventListener("afterprint", restoreTitle);
}

function backupData() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join("");
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: "all-buildings",
    storageKey,
    current,
    buildings,
    childProfiles,
    academies,
    educationEntries,
    currentAppTab
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `다가구-통합관리-전체백업-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBackupData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const importedBuildings = Array.isArray(parsed.buildings) ? parsed.buildings : null;
      if (!importedBuildings || importedBuildings.length === 0) {
        window.alert("불러올 수 있는 백업 데이터가 없습니다.");
        return;
      }

      if (!window.confirm("현재 데이터를 백업 파일 내용으로 바꿀까요?")) {
        return;
      }

      buildings = importedBuildings;
      childProfiles = normalizeChildProfiles(parsed.childProfiles);
      current = Math.min(Number(parsed.current) || 0, buildings.length - 1);
      academies = Array.isArray(parsed.academies) ? parsed.academies : [];
      educationEntries = Array.isArray(parsed.educationEntries) ? parsed.educationEntries : [];
      normalizeEducationData();
      currentAppTab = parsed.currentAppTab || "dashboard";
      persistLocalState();
      load();
      setAppTab(currentAppTab);
    } catch (error) {
      window.alert("백업 파일을 읽지 못했습니다.");
    } finally {
      importDataInput.value = "";
    }
  };
  reader.readAsText(file);
}

document.addEventListener("input", (event) => {
  if (event.target.matches(".rent-record-input, .rent-interest-input")) {
    return;
  }

  if (event.target === educationDate) {
    educationDate.value = formatShortDateInput(educationDate.value);
  }

  if (event.target === academyQuickDate) {
    academyQuickDate.value = formatShortDateInput(academyQuickDate.value);
  }

  if (event.target.matches(".tenant-phone")) {
    event.target.value = formatPhoneNumber(event.target.value);
  }

  if (event.target.matches(".num, .d, .m")) {
    const formatted = formatInputNumber(event.target.value);
    event.target.value = formatted;

    if (typeof event.target.selectionStart === "number") {
      const end = event.target.value.length;
      event.target.setSelectionRange(end, end);
    }
  }

  if (event.target === buyDate) {
    updateHoldingInfo();
  }

  if (event.target === address) {
    updateMap();
  }

  if (event.target === buildingNameInput) {
    rentRecordsTitle.innerText = getRentRecordsHeading();
  }

  if (event.target === buildingType) {
    updateBuildingTypeUi();
    generate();
  }

  if (event.target === apartmentDong || event.target === apartmentHo) {
    if (buildingType.value === "apartment") {
      generate();
    }
  }

  calc();
  save();
  renderDashboardTab();
});

function setFloorSettingsCollapsed(collapsed) {
  floorSettings.classList.toggle("collapsed", collapsed);
  floorSectionTitle.querySelector("h3").classList.toggle("hidden", collapsed);
  toggleFloorsButton.innerText = collapsed ? "층별 호실 설정 열기" : "층별 호실 설정 접기";
}

function setPropertyDetailsCollapsed(collapsed) {
  propertyDetails.classList.toggle("collapsed", collapsed);
  togglePropertyDetailsButton.innerText = collapsed ? "매입 정보 열기" : "매입 정보 접기";
}

togglePropertyDetailsButton.addEventListener("click", () => {
  const nextCollapsed = !propertyDetails.classList.contains("collapsed");
  setPropertyDetailsCollapsed(nextCollapsed);
  save();
});

toggleFloorsButton.addEventListener("click", () => {
  const nextCollapsed = !floorSettings.classList.contains("collapsed");
  setFloorSettingsCollapsed(nextCollapsed);
  save();
});

deleteBuildingButton.addEventListener("click", () => {
  if (buildings.length === 1) {
    if (!window.confirm("현재 건물을 비우고 새로 시작할까요?")) {
      return;
    }
    buildings = [newBuilding()];
      current = 0;
    } else {
    const currentName = buildings[current]?.name || `건물${current + 1}`;
    if (!window.confirm(`${currentName} 건물을 삭제할까요?`)) {
      return;
    }
    buildings.splice(current, 1);
    current = Math.max(0, current - 1);
  }

    localStorage.setItem(storageKey, JSON.stringify(buildings));
    load();
  });

moveBuildingLeftButton.addEventListener("click", () => {
  if (current <= 0) {
    return;
  }
  save();
  const temp = buildings[current - 1];
  buildings[current - 1] = buildings[current];
  buildings[current] = temp;
  current -= 1;
  persistLocalState();
  load();
});

moveBuildingRightButton.addEventListener("click", () => {
  if (current >= buildings.length - 1) {
    return;
  }
  save();
  const temp = buildings[current + 1];
  buildings[current + 1] = buildings[current];
  buildings[current] = temp;
  current += 1;
  persistLocalState();
  load();
});

printRentRecordsButton.addEventListener("click", () => {
  printRentRecords();
});

exportPdfButton.addEventListener("click", () => {
  exportRentRecordsPdf();
});

document.querySelectorAll(".app-tab").forEach((button) => {
  button.addEventListener("click", () => {
    setAppTab(button.dataset.tab);
  });
});

backupDataButton.addEventListener("click", () => {
  backupData();
});

importDataButton.addEventListener("click", () => {
  importDataInput.click();
});

importDataInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    importBackupData(file);
  }
});

educationPrevMonth.addEventListener("click", () => {
  shiftEducationMonth(-1);
  renderEducationTab();
});

educationNextMonth.addEventListener("click", () => {
  shiftEducationMonth(1);
  renderEducationTab();
});

dashboardPrevMonth.addEventListener("click", () => {
  shiftDashboardMonth(-1);
  renderDashboardTab();
});

dashboardNextMonth.addEventListener("click", () => {
  shiftDashboardMonth(1);
  renderDashboardTab();
});

document.querySelectorAll("[data-category-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    educationCategoryFilter = button.dataset.categoryFilter;
    document.querySelectorAll("[data-category-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.categoryFilter === educationCategoryFilter);
    });
    renderEducationTab();
  });
});

toggleAcademySectionButton.addEventListener("click", () => {
  setEducationSubsectionCollapsed("academy", !academySectionCollapsed);
});

toggleDirectEducationSectionButton.addEventListener("click", () => {
  setEducationSubsectionCollapsed("direct", !directEducationSectionCollapsed);
});

educationTodayButton.addEventListener("click", () => {
  const today = new Date();
  educationDate.value = formatShortDateInput(
    `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`
  );
});

academyQuickTodayButton.addEventListener("click", () => {
  academyQuickDate.value = getTodayShortDate();
});

academyQuickPrevDayButton.addEventListener("click", () => {
  academyQuickDate.value = shiftShortDate(academyQuickDate.value || getTodayShortDate(), -1);
});

academyQuickNextDayButton.addEventListener("click", () => {
  academyQuickDate.value = shiftShortDate(academyQuickDate.value || getTodayShortDate(), 1);
});

academyQuickAddButton.addEventListener("click", () => {
  const selectedAcademy = academies.find((academy) => academy.id === selectedAcademyId);
  if (!selectedAcademy) {
    window.alert("학원을 먼저 선택해 주세요.");
    return;
  }
  addQuickAcademyEntry();
});

toggleQuickAcademyDetailsButton.addEventListener("click", () => {
  setQuickAcademyDetailsCollapsed(!quickAcademyDetailsCollapsed);
});

addEducationEntryButton.addEventListener("click", () => {
  addEducationEntry();
});

addAcademyButton.addEventListener("click", () => {
  addAcademy();
});

educationColumns.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".education-delete-button");
  if (deleteButton) {
    deleteEducationEntry(deleteButton.dataset.entryId);
  }
});

academyList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".academy-action-button.delete");
  if (deleteButton) {
    deleteAcademy(deleteButton.dataset.academyId);
  }
});

academyQuickButtons.addEventListener("click", (event) => {
  const button = event.target.closest(".academy-quick-button");
  if (button) {
    selectedAcademyId = button.dataset.academyId;
    populateAcademyQuickSelect();
    return;
  }
});

educationChildManager.addEventListener("click", (event) => {
  const toggleButton = event.target.closest(".education-child-toggle");
  if (toggleButton) {
    setChildManagerCollapsed(!childManagerCollapsed);
    return;
  }

  const addButton = event.target.closest("#addChildProfileButton");
  if (addButton) {
    addChildProfile();
    return;
  }

  const removeButton = event.target.closest("[data-remove-child-id]");
  if (removeButton && !removeButton.disabled) {
    removeChildProfile(removeButton.dataset.removeChildId);
  }
});

educationChildManager.addEventListener("change", (event) => {
  const input = event.target.closest(".child-profile-name-input");
  if (!input) {
    return;
  }
  updateChildProfileName(input.dataset.childProfileId, input.value);
});

document.addEventListener("click", (event) => {
  const memoChoice = event.target.closest(".memo-choice");
  if (memoChoice) {
    toggleMemoChoice(memoChoice.dataset.target, memoChoice.dataset.value);
  }
});

loginButton.addEventListener("click", () => {
  handleLogin();
});

logoutButton.addEventListener("click", () => {
  handleLogout();
});

loginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleLogin();
  }
});

refreshRemoteButton.addEventListener("click", () => {
  refreshFromRemoteSnapshot(true);
});

householdSelect.addEventListener("change", () => {
  if (!currentSession?.user?.id || !householdSelect.value) {
    return;
  }
  switchHousehold(householdSelect.value, {
    userId: currentSession.user.id,
    announce: true
  });
});

pushRemoteButton.addEventListener("click", async () => {
  showAuthMessage("현재 기기 데이터를 클라우드에 올리는 중...");
  const success = await syncRemoteNow();
  if (success) {
    showAuthMessage("현재 기기 데이터를 클라우드에 올렸습니다.");
  }
});

window.addEventListener("focus", () => {
  if (canUseRemoteSync()) {
    checkForRemoteUpdates();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && canUseRemoteSync()) {
    checkForRemoteUpdates();
  }
});

if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
  document.body.classList.add("standalone-mode");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Keep the app usable even if service worker registration fails.
    });
  });
}

initializeSupabaseAuth();
