
// ================================================
// AgentDesk — Property CRM
// File: script.js
// ================================================

// STEP 1: Replace these two placeholders with your
// own Supabase Project URL and publishable/anon key.
// Never put a service_role or secret key in browser code.
const SUPABASE_URL = "https://hzhotlyvuxqykkttilef.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6aG90bHl2dXhxeWtrdHRpbGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNjY1MzUsImV4cCI6MjEwNTk0MjUzNX0.qW1C7wYI6rSBHkHkTle6A37z_uV5DSk94AmZuOJZauw";

const hasSupabaseConfig =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_SUPABASE") &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const supabaseClient =
  hasSupabaseConfig && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// App state
let currentUser = null;
let clients = [];
let interactions = [];
let currentView = "dashboard";
let authMode = "signin";
let activeDetailClientId = null;
let busy = false;
let birthdayPopupShown = false;

const STAGES = [
  "New Lead",
  "Contacted",
  "Viewing",
  "Negotiation",
  "Won",
  "Lost"
];

const ACTIVE_STAGES = [
  "New Lead",
  "Contacted",
  "Viewing",
  "Negotiation"
];

const VIEW_TEXT = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Here's an overview of your client activity."
  },
  clients: {
    title: "Clients",
    subtitle: "Manage your property contacts and potential deals."
  },
  followups: {
    title: "Follow-ups",
    subtitle: "Stay on top of your next conversations."
  },
  pipeline: {
    title: "Sales pipeline",
    subtitle: "Track every client from new lead to deal outcome."
  }
};

// HTML escaping for values supplied by users or the database.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function initials(name) {
  return String(name || "A")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join("")
    .toUpperCase();
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateValue) {
  if (!dateValue) return "Not set";

  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateValue);

  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Date not available";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatCurrency(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "Not set";

  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(amount);
}

function stageClass(stage) {
  return "stage-" + String(stage || "new-lead")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stageBadge(stage) {
  return `<span class="badge ${stageClass(stage)}">${escapeHTML(stage || "New Lead")}</span>`;
}

function showGlobalMessage(message, type = "info") {
  const element = document.getElementById("global-message");
  if (!element) return;

  element.textContent = message;
  element.className = `global-message ${type}`;

  window.clearTimeout(showGlobalMessage.timeout);
  showGlobalMessage.timeout = window.setTimeout(() => {
    element.classList.add("hidden");
  }, 5000);
}

function setMessage(id, message, type = "error") {
  const element = document.getElementById(id);
  if (!element) return;

  element.textContent = message;
  element.style.color = type === "success" ? "#21865b" : "";
}

function setBusy(button, isBusy, busyText = "Please wait...") {
  if (!button) return;

  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function getClientById(id) {
  return clients.find(client => client.id === id);
}

function isActiveClient(client) {
  return ACTIVE_STAGES.includes(client.stage);
}

function getFollowupStatus(client) {
  if (!client.follow_up_date) return "unscheduled";

  const today = localDateString();

  if (client.follow_up_date < today) return "overdue";
  if (client.follow_up_date === today) return "due-today";
  return "upcoming";
}

function getFollowupLabel(client) {
  const status = getFollowupStatus(client);

  if (status === "overdue") return "Overdue";
  if (status === "due-today") return "Due today";
  if (status === "upcoming") return formatDate(client.follow_up_date);

  return "Not scheduled";
}


// ================================================
// Birthday Calculation Helpers
// ================================================

function parseBirthday(birthdayValue) {
  if (!birthdayValue) return null;
  // Expected format: YYYY-MM-DD
  const parts = String(birthdayValue).split("-");
  if (parts.length !== 3) return null;

  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (Number.isNaN(month) || Number.isNaN(day)) return null;
  return { month, day };
}

function getBirthdayStatus(birthdayValue, today = new Date()) {
  const bday = parseBirthday(birthdayValue);
  if (!bday) return null;

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  // Create date for this year's birthday
  // Handle leap day (Feb 29) on non-leap years by falling back to Feb 28 or Mar 1 (we'll check Feb 28/29 safely)
  let targetYear = currentYear;
  let targetMonth = bday.month;
  let targetDay = bday.day;

  // Check if Feb 29 on non-leap year
  if (targetMonth === 2 && targetDay === 29) {
    const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
    if (!isLeap) targetDay = 28;
  }

  let targetDate = new Date(targetYear, targetMonth - 1, targetDay);
  targetDate.setHours(0, 0, 0, 0);

  const normalizedToday = new Date(currentYear, currentMonth - 1, currentDay);
  normalizedToday.setHours(0, 0, 0, 0);

  let diffTime = targetDate.getTime() - normalizedToday.getTime();
  let diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  // If the birthday already passed this year, look at next year's occurrence
  if (diffDays < 0) {
    targetYear = currentYear + 1;
    if (targetMonth === 2 && targetDay === 29) {
      const isLeapNext = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
      targetDay = isLeapNext ? 29 : 28;
    }
    targetDate = new Date(targetYear, targetMonth - 1, targetDay);
    targetDate.setHours(0, 0, 0, 0);
    diffTime = targetDate.getTime() - normalizedToday.getTime();
    diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  return {
    diffDays,
    isToday: diffDays === 0,
    isUpcoming: diffDays > 0 && diffDays <= 7,
    label: diffDays === 0 ? "Birthday today" : diffDays === 1 ? "In 1 day" : `In ${diffDays} days`
  };
}

function getUpcomingBirthdays() {
  return clients
    .filter(client => client.birthday)
    .map(client => ({
      client,
      status: getBirthdayStatus(client.birthday)
    }))
    .filter(item => item.status && item.status.diffDays <= 7)
    .sort((a, b) => a.status.diffDays - b.status.diffDays);
}


// ================================================
// Birthday Pop-up & Greetings
// ================================================

function checkTodayBirthdayPopup() {
  if (birthdayPopupShown) return;

  const upcoming = getUpcomingBirthdays();
  console.log("All upcoming/today birthdays detected:", upcoming); // Debug log to F12

  const todayBirthdays = upcoming.filter(item => item.status && item.status.isToday);
  console.log("Filtered birthdays due strictly today:", todayBirthdays); // Debug log to F12

  if (!todayBirthdays.length) return;

  const container = document.getElementById("birthday-popup-list");
  if (!container) return;

  container.innerHTML = todayBirthdays.map(({ client }) => `
    <article class="followup-item">
      <div class="followup-indicator due-today"></div>
      <div class="followup-content">
        <strong>${escapeHTML(client.full_name)}</strong>
        <p>${escapeHTML(client.client_type || "Client")} · ${escapeHTML(client.phone || client.email || "No contact info")}</p>
        <span class="followup-date due-today">Birthday today!</span>
      </div>
      <button class="btn btn-secondary copy-birthday-btn" style="font-size: 11px; padding: 6px 10px;"
        data-client-name="${escapeHTML(client.full_name)}" type="button">
        📋 Copy greeting
      </button>
    </article>
  `).join("");

  container.querySelectorAll(".copy-birthday-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      copyBirthdayGreeting(btn.dataset.clientName || "");
    });
  });

  const dialog = document.getElementById("birthday-popup");
  if (dialog && !dialog.open) {
    dialog.showModal();
    birthdayPopupShown = true;
  }
}

function copyBirthdayGreeting(clientName) {
  const greeting = `Hi ${clientName}, wishing you a very Happy Birthday! 🎂 May this year bring you good health, happiness, and continued success. Thank you for keeping in touch!`;

  navigator.clipboard.writeText(greeting).then(() => {
    showGlobalMessage(`Birthday greeting copied for ${clientName}!`, "success");
  }).catch(() => {
    showGlobalMessage("Unable to copy greeting to clipboard.", "error");
  });
}





// ================================================
// Authentication
// ================================================

function updateAuthMode() {
  const title = document.querySelector("#auth-screen h1");
  const submit = document.getElementById("auth-submit");
  const toggle = document.getElementById("toggle-auth");

  if (authMode === "signin") {
    title.textContent = "Welcome to AgentDesk";
    submit.textContent = "Sign in";
    toggle.textContent = "New here? Create an account";
  } else {
    title.textContent = "Create your account";
    submit.textContent = "Create account";
    toggle.textContent = "Already have an account? Sign in";
  }

  setMessage("auth-message", "");
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const button = document.getElementById("auth-submit");

  if (!supabaseClient) {
    setMessage(
      "auth-message",
      "Supabase is not configured yet. Add your Project URL and publishable/anon key in script.js."
    );
    return;
  }

  if (busy) return;
  busy = true;
  setBusy(button, true);

  try {
    let result;

    if (authMode === "signin") {
      result = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });
    } else {
      result = await supabaseClient.auth.signUp({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (authMode === "signup" && !result.data.session) {
      setMessage(
        "auth-message",
        "Account created. Check your email to confirm your account, then sign in.",
        "success"
      );
    } else if (result.data.user) {
      currentUser = result.data.user;
      await showApp();
    }
  } catch (error) {
    setMessage("auth-message", error.message || "Unable to sign in.");
  } finally {
    busy = false;
    setBusy(button, false);
  }
}

async function handleSignOut() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  currentUser = null;
  clients = [];
  interactions = [];

  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("auth-form").reset();
  setMessage("auth-message", "");
}

async function handleSignOut() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  currentUser = null;
  clients = [];
  interactions = [];
  birthdayPopupShown = false;

  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("auth-form").reset();
  setMessage("auth-message", "");
}

async function showApp() {
  if (!currentUser) return;

  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  document.getElementById("user-email").textContent =
    currentUser.email || "Agent account";

  document.getElementById("user-avatar").textContent =
    initials(currentUser.email || "Agent");

  document.getElementById("today-label").textContent =
    new Intl.DateTimeFormat("en-MY", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date());

  await refreshData();
  renderView(currentView);

  // Trigger today's birthday pop-up automatically once per session
  window.setTimeout(checkTodayBirthdayPopup, 800);
}
// ================================================
// Supabase data access
// ================================================

async function refreshData() {
  if (!supabaseClient || !currentUser) return;

  const clientResult = await supabaseClient
    .from("crm_clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (clientResult.error) {
    showGlobalMessage(
      `Unable to load clients: ${clientResult.error.message}. Check that the Supabase tables and policies are set up.`,
      "error"
    );
    return;
  }

  clients = clientResult.data || [];

  const interactionResult = await supabaseClient
    .from("crm_interactions")
    .select("*")
    .order("interaction_date", { ascending: false });

  if (interactionResult.error) {
    showGlobalMessage(
      `Clients loaded, but interaction history could not be loaded: ${interactionResult.error.message}`,
      "error"
    );
    interactions = [];
  } else {
    interactions = interactionResult.data || [];
  }

  renderDashboard();
  renderClientsTable();
  renderFollowups();
  renderPipeline();
  updateNavigationCounts();
}

async function saveClientRecord(formData, clientId) {
  if (!supabaseClient || !currentUser) {
    throw new Error("Please sign in before saving a client.");
  }

  const record = {
    full_name: formData.full_name,
    phone: formData.phone || null,
    email: formData.email || null,
    birthday: formData.birthday || null,
    client_type: formData.client_type,
    stage: formData.stage,
    property_interest: formData.property_interest || null,
    budget: formData.budget === "" ? null : Number(formData.budget),
    follow_up_date: formData.follow_up_date || null,
    notes: formData.notes || null,
    updated_at: new Date().toISOString()
  };

  if (clientId) {
    const { error } = await supabaseClient
      .from("crm_clients")
      .update(record)
      .eq("id", clientId);

    if (error) throw error;
  } else {
    record.user_id = currentUser.id;

    const { error } = await supabaseClient
      .from("crm_clients")
      .insert(record);

    if (error) throw error;
  }
}

async function saveInteractionRecord(formData) {
  if (!supabaseClient || !currentUser) {
    throw new Error("Please sign in before saving an interaction.");
  }

  const { error } = await supabaseClient
    .from("crm_interactions")
    .insert({
      user_id: currentUser.id,
      client_id: formData.client_id,
      interaction_type: formData.interaction_type,
      interaction_date: formData.interaction_date,
      notes: formData.notes
    });

  if (error) throw error;
}

async function updateClientStage(clientId, stage) {
  if (!STAGES.includes(stage)) {
    throw new Error("Invalid sales stage.");
  }

  const { error } = await supabaseClient
    .from("crm_clients")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) throw error;

  await refreshData();
  showGlobalMessage("Client stage updated.", "success");
}

// ================================================
// Navigation
// ================================================

function navigate(view) {
  if (!VIEW_TEXT[view]) return;

  currentView = view;
  renderView(view);
}

function renderView(view) {
  currentView = view;

  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  });

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  const page = VIEW_TEXT[view];
  document.getElementById("page-title").textContent = page.title;
  document.getElementById("page-subtitle").textContent = page.subtitle;

  if (view === "dashboard") renderDashboard();
  if (view === "clients") renderClientsTable();
  if (view === "followups") renderFollowups();
  if (view === "pipeline") renderPipeline();
}

function updateNavigationCounts() {
  document.getElementById("nav-client-count").textContent = clients.length;
  
  // Optional: update badge or indicator if birthdays are due today
  const todayBirthdays = getUpcomingBirthdays().filter(item => item.status.isToday);
  // You can hook this up to a sidebar badge element if desired!
}

// ================================================
// Dashboard
// ================================================

function renderDashboard() {
  const activeClients = clients.filter(isActiveClient);
  const dueFollowups = clients.filter(client => {
    const status = getFollowupStatus(client);
    return isActiveClient(client) &&
      (status === "overdue" || status === "due-today");
  });

  const wonClients = clients.filter(client => client.stage === "Won");

  document.getElementById("stat-clients").textContent = clients.length;
  document.getElementById("stat-leads").textContent = activeClients.length;
  document.getElementById("stat-followups").textContent = dueFollowups.length;
  document.getElementById("stat-won").textContent = wonClients.length;

  renderRecentClients();
  renderDashboardFollowups();
  renderDashboardBirthdays();
  renderPipelineSummary();
}

function renderRecentClients() {
  const container = document.getElementById("recent-clients");
  const recent = clients.slice(0, 5);

  if (!recent.length) {
    container.innerHTML =
      '<div class="empty-state">No clients yet. Select “Add client” to create your first record.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>CLIENT</th>
          <th>STAGE</th>
          <th>FOLLOW-UP</th>
        </tr>
      </thead>
      <tbody>
        ${recent.map(client => `
          <tr>
            <td>
              <div class="person-cell">
                <div class="mini-avatar">${escapeHTML(initials(client.full_name))}</div>
                <div>
                  <button class="table-link" data-action="details" data-id="${escapeHTML(client.id)}">
                    ${escapeHTML(client.full_name)}
                  </button>
                  <small>${escapeHTML(client.client_type || "Other")}</small>
                </div>
              </div>
            </td>
            <td>${stageBadge(client.stage)}</td>
            <td>${escapeHTML(formatDate(client.follow_up_date))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderDashboardBirthdays() {
  const container = document.getElementById("dashboard-birthdays");
  if (!container) return;

  const upcoming = getUpcomingBirthdays();

  if (!upcoming.length) {
    container.innerHTML = '<div class="empty-state">No upcoming birthdays this week.</div>';
    return;
  }

  container.innerHTML = upcoming.map(({ client, status }) => `
    <article class="followup-item">
      <div class="followup-indicator ${status.isToday ? "due-today" : "upcoming"}"></div>
      <div class="followup-content">
        <strong>
          <button class="table-link" data-action="details" data-id="${escapeHTML(client.id)}">
            ${escapeHTML(client.full_name)}
          </button>
        </strong>
        <p>${escapeHTML(client.client_type || "Client")} · ${escapeHTML(formatDate(client.birthday))}</p>
        <span class="followup-date ${status.isToday ? "due-today" : "upcoming"}">
          ${escapeHTML(status.label)}
        </span>
      </div>
      <button class="icon-button" title="View client" aria-label="View client"
        data-action="details" data-id="${escapeHTML(client.id)}">↗</button>
    </article>
  `).join("");
}

function renderDashboardFollowups() {
  const container = document.getElementById("dashboard-followups");
  if (!container) return;

  const list = clients
    .filter(client => client.follow_up_date && isActiveClient(client))
    .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
    .slice(0, 5);

  if (!list.length) {
    container.innerHTML =
      '<div class="empty-state">No scheduled follow-ups. Add a date to a client record to see it here.</div>';
    return;
  }

  container.innerHTML = list.map(renderFollowupItem).join("");
}


function renderPipelineSummary() {
  const container = document.getElementById("dashboard-pipeline");

  container.innerHTML = STAGES.map(stage => {
    const count = clients.filter(client => client.stage === stage).length;

    return `
      <div class="pipeline-summary-item">
        <span>${escapeHTML(stage)}</span>
        <strong>${count}</strong>
      </div>
    `;
  }).join("");
}

// ================================================
// Client directory
// ================================================

function renderClientsTable() {
  const container = document.getElementById("clients-table");
  const search = document.getElementById("client-search").value
    .trim()
    .toLowerCase();
  const stage = document.getElementById("stage-filter").value;

  const filtered = clients.filter(client => {
    const searchable = [
      client.full_name,
      client.phone,
      client.email,
      client.property_interest,
      client.client_type
    ].join(" ").toLowerCase();

    return searchable.includes(search) &&
      (!stage || client.stage === stage);
  });

  document.getElementById("clients-pagination").textContent =
    `${filtered.length} client${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        ${clients.length
          ? "No clients match your search or selected filter."
          : "Your directory is empty. Click “Add client” to get started."}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>CLIENT</th>
          <th>TYPE</th>
          <th>STAGE</th>
          <th>BUDGET</th>
          <th>FOLLOW-UP</th>
          <th>ACTIONS</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(client => `
          <tr>
            <td>
              <div class="person-cell">
                <div class="mini-avatar">${escapeHTML(initials(client.full_name))}</div>
                <div>
                  <button class="table-link" data-action="details" data-id="${escapeHTML(client.id)}">
                    ${escapeHTML(client.full_name)}
                  </button>
                  <small>${escapeHTML(client.phone || client.email || "No contact details")}</small>
                </div>
              </div>
            </td>
            <td>${escapeHTML(client.client_type || "Other")}</td>
            <td>${stageBadge(client.stage)}</td>
            <td>${escapeHTML(formatCurrency(client.budget))}</td>
            <td>${escapeHTML(formatDate(client.follow_up_date))}</td>
            <td>
              <div class="table-actions">
                <button class="icon-button" title="View client" aria-label="View client"
                  data-action="details" data-id="${escapeHTML(client.id)}">↗</button>
                <button class="icon-button" title="Edit client" aria-label="Edit client"
                  data-action="edit" data-id="${escapeHTML(client.id)}">✎</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ================================================
// Follow-ups
// ================================================

function renderFollowupItem(client) {
  const status = getFollowupStatus(client);
  const label = getFollowupLabel(client);

  return `
    <article class="followup-item">
      <div class="followup-indicator ${escapeHTML(status)}"></div>
      <div class="followup-content">
        <strong>
          <button class="table-link" data-action="details" data-id="${escapeHTML(client.id)}">
            ${escapeHTML(client.full_name)}
          </button>
        </strong>
        <p>${escapeHTML(client.property_interest || client.client_type || "Property enquiry")}</p>
        <span class="followup-date ${escapeHTML(status)}">
          ${escapeHTML(label)}
        </span>
      </div>
      <button class="icon-button" title="View client" aria-label="View client"
        data-action="details" data-id="${escapeHTML(client.id)}">↗</button>
    </article>
  `;
}

function renderFollowups() {
  const activeFollowups = clients
    .filter(client => client.follow_up_date && isActiveClient(client))
    .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date));

  document.getElementById("all-followups").innerHTML = activeFollowups.length
    ? activeFollowups.map(renderFollowupItem).join("")
    : '<div class="empty-state">No scheduled follow-ups yet. Add a follow-up date to an active client.</div>';

  renderDashboardFollowups();
}

// ================================================
// Sales pipeline
// ================================================

function renderPipeline() {
  const container = document.getElementById("pipeline-board");
  const boardStages = [
    ["New Lead", "Contacted"],
    ["Viewing", "Negotiation"],
    ["Won", "Lost"]
  ];

  container.innerHTML = boardStages.map(group => `
    <section class="pipeline-column">
      <div class="pipeline-column-heading">
        <strong>${escapeHTML(group.join(" / "))}</strong>
        <span>${clients.filter(client => group.includes(client.stage)).length}</span>
      </div>
      <div class="pipeline-cards">
        ${clients.filter(client => group.includes(client.stage)).map(client => `
          <article class="pipeline-card">
            <div class="person-cell">
              <div class="mini-avatar">${escapeHTML(initials(client.full_name))}</div>
              <div>
                <button class="table-link" data-action="details" data-id="${escapeHTML(client.id)}">
                  ${escapeHTML(client.full_name)}
                </button>
                <small>${escapeHTML(client.client_type || "Other")}</small>
              </div>
            </div>
            <p>${escapeHTML(client.property_interest || "No property preference recorded")}</p>
            <p><strong>Budget:</strong> ${escapeHTML(formatCurrency(client.budget))}</p>
            <label for="stage-${escapeHTML(client.id)}">Update stage</label>
            <select id="stage-${escapeHTML(client.id)}"
              data-action="stage" data-id="${escapeHTML(client.id)}">
              ${STAGES.map(stage => `
                <option value="${escapeHTML(stage)}" ${client.stage === stage ? "selected" : ""}>
                  ${escapeHTML(stage)}
                </option>
              `).join("")}
            </select>
          </article>
        `).join("") || '<div class="empty-state">No clients in this group.</div>'}
      </div>
    </section>
  `).join("");

  renderPipelineSummary();
}

// ================================================
// Add and edit clients
// ================================================

function openClientDialog(client = null) {
  const dialog = document.getElementById("client-dialog");
  const form = document.getElementById("client-form");

  form.reset();
  setMessage("client-form-message", "");

  document.getElementById("client-dialog-title").textContent =
    client ? "Edit client" : "Add new client";

  document.getElementById("client-id").value = client?.id || "";
  document.getElementById("client-name").value = client?.full_name || "";
  document.getElementById("client-phone").value = client?.phone || "";
  document.getElementById("client-email").value = client?.email || "";
  document.getElementById("client-birthday").value = client?.birthday || "";
  document.getElementById("client-type").value = client?.client_type || "Buyer";
  document.getElementById("client-stage").value = client?.stage || "New Lead";
  document.getElementById("client-property").value = client?.property_interest || "";
  document.getElementById("client-budget").value = client?.budget ?? "";
  document.getElementById("client-followup").value = client?.follow_up_date || "";
  document.getElementById("client-notes").value = client?.notes || "";

  if (!dialog.open) dialog.showModal();
}

async function handleClientSave(event) {
  event.preventDefault();

  const form = document.getElementById("client-form");
  if (!form.reportValidity() || busy) return;

  const clientId = document.getElementById("client-id").value || null;
  const budgetText = document.getElementById("client-budget").value;

  const formData = {
    full_name: document.getElementById("client-name").value.trim(),
    phone: document.getElementById("client-phone").value.trim(),
    email: document.getElementById("client-email").value.trim(),
    birthday: document.getElementById("client-birthday").value,
    client_type: document.getElementById("client-type").value,
    stage: document.getElementById("client-stage").value,
    property_interest: document.getElementById("client-property").value.trim(),
    budget: budgetText,
    follow_up_date: document.getElementById("client-followup").value,
    notes: document.getElementById("client-notes").value.trim()
  };

  if (!formData.full_name) {
    setMessage("client-form-message", "Please enter the client's name.");
    return;
  }

  if (budgetText !== "" &&
      (!Number.isFinite(Number(budgetText)) || Number(budgetText) < 0)) {
    setMessage("client-form-message", "Please enter a valid non-negative budget.");
    return;
  }

  busy = true;
  const button = document.getElementById("save-client");
  setBusy(button, true, "Saving...");

  try {
    await saveClientRecord(formData, clientId);
    await refreshData();

    document.getElementById("client-dialog").close();
    showGlobalMessage(
      clientId ? "Client updated successfully." : "Client added successfully.",
      "success"
    );
  } catch (error) {
    setMessage("client-form-message", error.message || "Unable to save client.");
  } finally {
    busy = false;
    setBusy(button, false);
  }
}

// ================================================
// Client details and interaction history
// ================================================

function openClientDetails(clientId) {
  const client = getClientById(clientId);
  if (!client) return;

  activeDetailClientId = clientId;

  document.getElementById("detail-client-name").textContent = client.full_name;
  document.getElementById("detail-client-meta").textContent =
    `${client.client_type || "Other"} · ${client.stage || "New Lead"}`;

  document.getElementById("detail-client-info").innerHTML = `
    <div class="detail-info-item">
      <span>Phone</span>
      <strong>${escapeHTML(client.phone || "Not provided")}</strong>
    </div>
    <div class="detail-info-item">
      <span>Email</span>
      <strong>${escapeHTML(client.email || "Not provided")}</strong>
    </div>
    <div class="detail-info-item">
      <span>Birthday</span>
      <strong>${escapeHTML(formatDate(client.birthday))}</strong>
    </div>
    <div class="detail-info-item">
      <span>Property interest</span>
      <strong>${escapeHTML(client.property_interest || "Not provided")}</strong>
    </div>
    <div class="detail-info-item">
      <span>Budget</span>
      <strong>${escapeHTML(formatCurrency(client.budget))}</strong>
    </div>
    <div class="detail-info-item">
      <span>Next follow-up</span>
      <strong>${escapeHTML(formatDate(client.follow_up_date))}</strong>
    </div>
    <div class="detail-info-item">
      <span>Notes</span>
      <strong>${escapeHTML(client.notes || "No notes yet")}</strong>
    </div>
  `;

  document.getElementById("interaction-client-id").value = clientId;
  document.getElementById("interaction-date").value = localDateString();
  document.getElementById("interaction-notes").value = "";
  setMessage("interaction-message", "");

  renderInteractionHistory(clientId);

  const dialog = document.getElementById("detail-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderInteractionHistory(clientId) {
  const container = document.getElementById("interaction-history");

  const clientInteractions = interactions
    .filter(item => item.client_id === clientId)
    .sort((a, b) => {
      const dateA = new Date(a.interaction_date || a.created_at || 0);
      const dateB = new Date(b.interaction_date || b.created_at || 0);
      return dateB - dateA;
    });

  if (!clientInteractions.length) {
    container.innerHTML =
      '<div class="empty-state">No interactions recorded yet. Add a call, WhatsApp conversation, email or meeting above.</div>';
    return;
  }

  container.innerHTML = clientInteractions.map(item => `
    <article class="history-item">
      <div class="history-item-top">
        <strong>${escapeHTML(item.interaction_type || "Interaction")}</strong>
        <span>${escapeHTML(formatDate(item.interaction_date))}</span>
      </div>
      <p>${escapeHTML(item.notes || "")}</p>
    </article>
  `).join("");
}

async function handleInteractionSave(event) {
  event.preventDefault();

  const form = document.getElementById("interaction-form");
  if (!form.reportValidity() || busy) return;

  const formData = {
    client_id: document.getElementById("interaction-client-id").value,
    interaction_type: document.getElementById("interaction-type").value,
    interaction_date: document.getElementById("interaction-date").value,
    notes: document.getElementById("interaction-notes").value.trim()
  };

  if (!formData.notes) {
    setMessage("interaction-message", "Please enter conversation notes.");
    return;
  }

  busy = true;
  const button = document.getElementById("save-interaction");
  setBusy(button, true, "Saving...");

  try {
    await saveInteractionRecord(formData);
    await refreshData();

    document.getElementById("interaction-notes").value = "";
    document.getElementById("interaction-date").value = localDateString();

    renderInteractionHistory(formData.client_id);
    setMessage("interaction-message", "Interaction saved.", "success");
  } catch (error) {
    setMessage(
      "interaction-message",
      error.message || "Unable to save interaction."
    );
  } finally {
    busy = false;
    setBusy(button, false);
  }
}

function editClientFromDetails() {
  const client = getClientById(activeDetailClientId);
  if (!client) return;

  document.getElementById("detail-dialog").close();
  openClientDialog(client);
}

// ================================================
// Event listeners
// ================================================

function bindEvents() {
  document.getElementById("auth-form")
    .addEventListener("submit", handleAuthSubmit);

  document.getElementById("toggle-auth").addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    updateAuthMode();
  });

  document.getElementById("sign-out")
    .addEventListener("click", handleSignOut);

  document.getElementById("add-client-top")
    .addEventListener("click", () => openClientDialog());

  document.getElementById("add-client-directory")
    .addEventListener("click", () => openClientDialog());

  document.getElementById("client-form")
    .addEventListener("submit", handleClientSave);

  document.getElementById("interaction-form")
    .addEventListener("submit", handleInteractionSave);

  document.getElementById("edit-client-from-detail")
    .addEventListener("click", editClientFromDetails);

  document.getElementById("client-search")
    .addEventListener("input", renderClientsTable);

  document.getElementById("stage-filter")
    .addEventListener("change", renderClientsTable);

  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => {
      const dialog = button.closest("dialog");
      if (dialog) dialog.close();
    });
  });

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      navigate(button.dataset.view);
    });
  });

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const clientId = button.dataset.id;

    if (action === "details") {
      openClientDetails(clientId);
    }

    if (action === "edit") {
      const client = getClientById(clientId);
      if (client) openClientDialog(client);
    }
  });

  document.addEventListener("change", async event => {
    const select = event.target.closest('select[data-action="stage"]');
    if (!select) return;

    const clientId = select.dataset.id;
    const newStage = select.value;

    select.disabled = true;

    try {
      await updateClientStage(clientId, newStage);
    } catch (error) {
      showGlobalMessage(error.message || "Unable to update stage.", "error");
      renderPipeline();
    } finally {
      select.disabled = false;
    }
  });

  // Clicking the dark backdrop closes the dialog.
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

// ================================================
// Start the application
// ================================================

async function initApp() {
  bindEvents();
  updateAuthMode();

  if (!supabaseClient) {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");

    setMessage(
      "auth-message",
      "Setup needed: add your Supabase Project URL and publishable/anon key near the top of script.js."
    );
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    setMessage("auth-message", error.message);
    return;
  }

  currentUser = data.session?.user || null;

  if (currentUser) {
    await showApp();
  } else {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    const nextUser = session?.user || null;

    if (nextUser && (!currentUser || currentUser.id !== nextUser.id)) {
      currentUser = nextUser;
      window.setTimeout(() => showApp(), 0);
    } else if (!nextUser && currentUser) {
      currentUser = null;
      clients = [];
      interactions = [];
      document.getElementById("app-shell").classList.add("hidden");
      document.getElementById("auth-screen").classList.remove("hidden");
    }
  });
}

document.addEventListener("DOMContentLoaded", initApp);
