import { h, render } from "https://esm.sh/preact@10.25.4";
import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.25.4/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

// --- API client ---
const api = {
  async _fetch(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...opts.headers },
      credentials: "same-origin",
    });
    if (res.status === 401) {
      window.location.hash = "#/login";
      throw new Error("unauthorized");
    }
    return res.json();
  },
  get: (p) => api._fetch(p),
  post: (p, body) => api._fetch(p, { method: "POST", body: JSON.stringify(body) }),
  del: (p) => api._fetch(p, { method: "DELETE" }),
};

// --- Router ---
function useRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const handler = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}

function NavLink({ href, children }) {
  const route = useRoute();
  const active = route === href || (href !== "#/" && route.startsWith(href));
  return html`<a href=${href} class=${active ? "active" : ""}>${children}</a>`;
}

// --- Pages ---

function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/v1/stats").then(setStats); }, []);
  if (!stats) return html`<div class="empty-state">Loading...</div>`;
  return html`
    <h2>Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${stats.entityCount}</div><div class="stat-label">Entities</div></div>
      <div class="stat-card"><div class="stat-value">${stats.pendingReviewCount}</div><div class="stat-label">Pending Reviews</div></div>
      <div class="stat-card"><div class="stat-value">${stats.pendingSecurityCount}</div><div class="stat-label">Pending Approvals</div></div>
      <div class="stat-card"><div class="stat-value">${stats.ruleCount}</div><div class="stat-label">Security Rules</div></div>
      <div class="stat-card"><div class="stat-value">${stats.recentDecisions}</div><div class="stat-label">Recent Decisions</div></div>
    </div>
  `;
}

function Entities() {
  const [entities, setEntities] = useState([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    api.get(`/v1/entities?${params}`).then(setEntities);
  }, [q, kind]);
  useEffect(load, [q, kind]);

  const toggleWhitelist = async (id, current) => {
    await api.post(`/v1/entities/${id}/whitelist`, { whitelisted: !current });
    load();
  };

  return html`
    <h2>Entities</h2>
    <div class="toolbar">
      <input placeholder="Search..." value=${q} onInput=${(e) => setQ(e.target.value)} style="max-width:300px" />
      <select value=${kind} onChange=${(e) => setKind(e.target.value)} style="max-width:160px">
        <option value="">All kinds</option>
        ${["person","company","email","phone","domain","url","handle","address","id","asset","secret"].map(
          (k) => html`<option value=${k}>${k}</option>`
        )}
      </select>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Kind</th><th>Real</th><th>Mirror</th><th>Whitelisted</th><th>Actions</th></tr></thead>
        <tbody>
          ${entities.length === 0 ? html`<tr><td colspan="5" class="empty-state">No entities found</td></tr>` : null}
          ${entities.map((e) => html`
            <tr key=${e.id}>
              <td><span class="badge badge-blue">${e.kind}</span></td>
              <td class="mono truncate" title=${e.real}>${e.real}</td>
              <td class="mono truncate" title=${e.mirror}>${e.mirror}</td>
              <td>${e.whitelisted ? html`<span class="badge badge-green">Yes</span>` : html`<span class="badge badge-red">No</span>`}</td>
              <td><button class="btn-sm" onClick=${() => toggleWhitelist(e.id, e.whitelisted)}>${e.whitelisted ? "Revoke" : "Whitelist"}</button></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function Reviews() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("pending");
  const load = useCallback(() => {
    api.get(`/v1/review/items?status=${filter}`).then(setItems);
  }, [filter]);
  useEffect(load, [filter]);

  const act = async (id, action, body) => {
    await api.post(`/v1/review/items/${id}/${action}`, body || {});
    load();
  };

  return html`
    <h2>Reviews</h2>
    <div class="toolbar">
      ${["pending", "approved", "whitelisted", "merged"].map((s) => html`
        <button class=${filter === s ? "btn-primary btn-sm" : "btn-sm"} onClick=${() => setFilter(s)}>${s}</button>
      `)}
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Kind</th><th>Value</th><th>Confidence</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${items.length === 0 ? html`<tr><td colspan="5" class="empty-state">No items</td></tr>` : null}
          ${items.map((item) => html`
            <tr key=${item.id}>
              <td><span class="badge badge-blue">${item.kind}</span></td>
              <td class="mono truncate">${item.value}</td>
              <td>${item.confidence ? (item.confidence * 100).toFixed(0) + "%" : "-"}</td>
              <td><span class="badge ${item.status === "pending" ? "badge-yellow" : "badge-green"}">${item.status}</span></td>
              <td class="flex gap-8">
                ${item.status === "pending" ? html`
                  <button class="btn-sm" onClick=${() => act(item.id, "approve-new")}>Approve</button>
                  <button class="btn-sm" onClick=${() => act(item.id, "whitelist")}>Whitelist</button>
                ` : null}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function SecurityRules() {
  const [rules, setRules] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ targetType: "mcp_tool", targetName: "", direction: "in", effect: "deny_always_call", priority: 10 });
  const load = useCallback(() => { api.get("/v1/security/rules").then(setRules); }, []);
  useEffect(load, []);

  const addRule = async () => {
    await api.post("/v1/security/rules", {
      ...form,
      paramMatch: {},
      scope: { type: "none", filesystem: [], network: false },
    });
    setShowAdd(false);
    load();
  };
  const deleteRule = async (id) => { await api.del(`/v1/security/rules/${id}`); load(); };

  return html`
    <h2>Security Rules</h2>
    <div class="toolbar">
      <button class="btn-primary btn-sm" onClick=${() => setShowAdd(!showAdd)}>${showAdd ? "Cancel" : "Add Rule"}</button>
    </div>
    ${showAdd ? html`
      <div class="card">
        <div class="input-group"><label>Target Type</label>
          <select value=${form.targetType} onChange=${(e) => setForm({ ...form, targetType: e.target.value })}>
            <option value="mcp_tool">mcp_tool</option><option value="mcp_resource">mcp_resource</option>
            <option value="shell">shell</option><option value="api">api</option>
          </select>
        </div>
        <div class="input-group"><label>Target Name</label>
          <input value=${form.targetName} onInput=${(e) => setForm({ ...form, targetName: e.target.value })} placeholder="e.g. email.send" />
        </div>
        <div class="input-group"><label>Direction</label>
          <select value=${form.direction} onChange=${(e) => setForm({ ...form, direction: e.target.value })}>
            <option value="in">in</option><option value="out">out</option><option value="inout">inout</option>
          </select>
        </div>
        <div class="input-group"><label>Effect</label>
          <select value=${form.effect} onChange=${(e) => setForm({ ...form, effect: e.target.value })}>
            <option value="deny_always_call">deny_always_call</option>
            <option value="allow_always_call">allow_always_call</option>
            <option value="allow_always_call_params">allow_always_call_params</option>
            <option value="allow_always_global">allow_always_global</option>
          </select>
        </div>
        <div class="input-group"><label>Priority</label>
          <input type="number" value=${form.priority} onInput=${(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        </div>
        <button class="btn-primary" onClick=${addRule}>Save</button>
      </div>
    ` : null}
    <div class="card">
      <table>
        <thead><tr><th>Target</th><th>Direction</th><th>Effect</th><th>Priority</th><th>Actions</th></tr></thead>
        <tbody>
          ${rules.length === 0 ? html`<tr><td colspan="5" class="empty-state">No rules</td></tr>` : null}
          ${rules.map((r) => html`
            <tr key=${r.id}>
              <td><span class="badge badge-blue">${r.targetType}</span> ${r.targetName}</td>
              <td>${r.direction}</td>
              <td><span class="badge ${r.effect.startsWith("allow") ? "badge-green" : "badge-red"}">${r.effect}</span></td>
              <td>${r.priority}</td>
              <td><button class="btn-sm btn-danger" onClick=${() => deleteRule(r.id)}>Delete</button></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function SecurityPending() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("pending");
  const load = useCallback(() => { api.get(`/v1/security/pending?status=${filter}`).then(setItems); }, [filter]);
  useEffect(load, [filter]);

  const act = async (id, action) => {
    await api.post(`/v1/security/pending/${id}/${action}`);
    load();
  };

  return html`
    <h2>Pending Approvals</h2>
    <div class="toolbar">
      ${["pending", "approved", "denied"].map((s) => html`
        <button class=${filter === s ? "btn-primary btn-sm" : "btn-sm"} onClick=${() => setFilter(s)}>${s}</button>
      `)}
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Target</th><th>Direction</th><th>Risk</th><th>Reasons</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${items.length === 0 ? html`<tr><td colspan="6" class="empty-state">No items</td></tr>` : null}
          ${items.map((item) => html`
            <tr key=${item.id}>
              <td><span class="badge badge-blue">${item.targetType}</span> ${item.targetName}</td>
              <td>${item.direction}</td>
              <td><span class="badge ${item.agentDecision?.riskLevel === "high" ? "badge-red" : item.agentDecision?.riskLevel === "medium" ? "badge-yellow" : "badge-green"}">${item.agentDecision?.riskLevel ?? "?"}</span></td>
              <td class="truncate" title=${item.summary}>${item.summary}</td>
              <td><span class="badge ${item.status === "pending" ? "badge-yellow" : item.status === "approved" ? "badge-green" : "badge-red"}">${item.status}</span></td>
              <td class="flex gap-8">
                ${item.status === "pending" ? html`
                  <button class="btn-sm" onClick=${() => act(item.id, "approve")}>Approve</button>
                  <button class="btn-sm btn-danger" onClick=${() => act(item.id, "deny")}>Deny</button>
                  <button class="btn-sm" onClick=${() => act(item.id, "approve-always-call")}>Always</button>
                  <button class="btn-sm" onClick=${() => act(item.id, "approve-always-params")}>Always+Params</button>
                ` : null}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function SecurityAudit() {
  const [decisions, setDecisions] = useState([]);
  useEffect(() => { api.get("/v1/security/decisions?limit=100").then(setDecisions); }, []);
  return html`
    <h2>Decision Audit</h2>
    <div class="card">
      <table>
        <thead><tr><th>Target</th><th>Direction</th><th>Decision</th><th>Source</th><th>Risk</th><th>Reasons</th><th>Time</th></tr></thead>
        <tbody>
          ${decisions.length === 0 ? html`<tr><td colspan="7" class="empty-state">No decisions recorded</td></tr>` : null}
          ${decisions.map((d) => html`
            <tr key=${d.id}>
              <td><span class="badge badge-blue">${d.targetType}</span> ${d.targetName}</td>
              <td>${d.direction}</td>
              <td><span class="badge ${d.decision === "allow" ? "badge-green" : d.decision === "deny" ? "badge-red" : "badge-yellow"}">${d.decision}</span></td>
              <td>${d.source}</td>
              <td><span class="badge ${d.riskLevel === "high" || d.riskLevel === "critical" ? "badge-red" : d.riskLevel === "medium" ? "badge-yellow" : "badge-green"}">${d.riskLevel}</span></td>
              <td class="truncate" title=${(d.reasons || []).join("; ")}>${(d.reasons || []).join("; ")}</td>
              <td class="mono" style="font-size:11px">${d.createdAt}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function Legislator() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.post("/v1/security/legislator/message", { message: msg });
      setMessages((prev) => [...prev, { role: "system", text: res.message || JSON.stringify(res) }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "system", text: "Error: " + e.message }]);
    }
    setSending(false);
  };

  return html`
    <h2>Legislator</h2>
    <p class="mb-16" style="color:var(--fg2); font-size:13px">Use natural language to manage security rules. Example: "Allow trello.createCard to always run" or "Block all shell commands by default".</p>
    <div class="card">
      <div class="chat-container" style="min-height:200px; max-height:400px; overflow-y:auto;">
        ${messages.length === 0 ? html`<div class="empty-state">No messages yet</div>` : null}
        ${messages.map((m, i) => html`<div key=${i} class="chat-msg ${m.role}">${m.text}</div>`)}
      </div>
      <div class="flex gap-8 mt-16">
        <input value=${input} onInput=${(e) => setInput(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && send()} placeholder="Type a rule change..." style="flex:1" />
        <button class="btn-primary" onClick=${send} disabled=${sending}>${sending ? "..." : "Send"}</button>
      </div>
    </div>
  `;
}

function RuleChanges() {
  const [changes, setChanges] = useState([]);
  const load = useCallback(() => { api.get("/v1/security/rule-changes").then(setChanges); }, []);
  useEffect(load, []);

  const revert = async (id) => {
    await api.post(`/v1/security/rule-changes/${id}/revert`);
    load();
  };

  return html`
    <h2>Rule Changes</h2>
    <div class="card">
      <table>
        <thead><tr><th>Actor</th><th>Message</th><th>Diff</th><th>Time</th><th>Actions</th></tr></thead>
        <tbody>
          ${changes.length === 0 ? html`<tr><td colspan="5" class="empty-state">No rule changes</td></tr>` : null}
          ${changes.map((c) => html`
            <tr key=${c.id}>
              <td><span class="badge ${c.actor === "legislator" ? "badge-blue" : "badge-green"}">${c.actor}</span></td>
              <td class="truncate" title=${c.userMessage}>${c.userMessage}</td>
              <td class="mono truncate" title=${(c.diff || []).join(", ")}>${(c.diff || []).join(", ")}</td>
              <td class="mono" style="font-size:11px">${c.createdAt}</td>
              <td><button class="btn-sm" onClick=${() => revert(c.id)}>Revert</button></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function FilterPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState("anonymize");

  const run = async () => {
    if (!text.trim()) return;
    const res = await api.post(`/v1/filter/${mode}`, { text });
    setResult(res);
  };

  return html`
    <h2>Filter</h2>
    <div class="toolbar">
      <button class=${mode === "anonymize" ? "btn-primary btn-sm" : "btn-sm"} onClick=${() => setMode("anonymize")}>Anonymize</button>
      <button class=${mode === "deanonymize" ? "btn-primary btn-sm" : "btn-sm"} onClick=${() => setMode("deanonymize")}>Deanonymize</button>
    </div>
    <div class="card">
      <div class="input-group"><label>Input Text</label>
        <textarea value=${text} onInput=${(e) => setText(e.target.value)} rows="6" placeholder="Paste text to ${mode}..." />
      </div>
      <button class="btn-primary" onClick=${run}>${mode === "anonymize" ? "Anonymize" : "Deanonymize"}</button>
      ${result ? html`
        <div class="mt-16">
          <div class="input-group"><label>Output</label>
            <textarea value=${result.text || ""} readOnly rows="6" />
          </div>
          ${result.replacements?.length ? html`
            <div class="mt-8" style="font-size:13px; color:var(--fg2)">${result.replacements.length} replacement(s) made</div>
          ` : null}
        </div>
      ` : null}
    </div>
  `;
}

function Login({ onLogin }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    setError("");
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.ok) { onLogin(); window.location.hash = "#/"; }
      else setError(data.error || "Login failed");
    } catch (e) { setError(e.message); }
  };
  return html`
    <div class="login-wrapper">
      <div class="login-box">
        <h2>PIITool Login</h2>
        ${error ? html`<div class="error">${error}</div>` : null}
        <div class="input-group"><label>Password</label>
          <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && submit()} />
        </div>
        <button class="btn-primary" style="width:100%; margin-top:8px" onClick=${submit}>Login</button>
      </div>
    </div>
  `;
}

// --- Router ---
const routes = {
  "#/": Dashboard,
  "#/entities": Entities,
  "#/reviews": Reviews,
  "#/security/rules": SecurityRules,
  "#/security/pending": SecurityPending,
  "#/security/audit": SecurityAudit,
  "#/security/legislator": Legislator,
  "#/security/rule-changes": RuleChanges,
  "#/filter": FilterPage,
};

function App() {
  const route = useRoute();
  const [authState, setAuthState] = useState({ checked: false, authed: false, required: false });

  useEffect(() => {
    fetch("/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setAuthState({ checked: true, authed: d.authenticated, required: d.authRequired }))
      .catch(() => setAuthState({ checked: true, authed: false, required: false }));
  }, []);

  if (!authState.checked) return html`<div class="empty-state" style="padding:60px">Loading...</div>`;

  if (authState.required && !authState.authed) {
    return html`<${Login} onLogin=${() => setAuthState({ ...authState, authed: true })} />`;
  }

  const Page = routes[route] || Dashboard;

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    setAuthState({ ...authState, authed: false });
  };

  return html`
    <div class="app-shell">
      <nav class="sidebar">
        <h1>PIITool</h1>
        <${NavLink} href="#/">Dashboard<//>
        <div class="nav-section">Data</div>
        <${NavLink} href="#/entities">Entities<//>
        <${NavLink} href="#/reviews">Reviews<//>
        <${NavLink} href="#/filter">Filter<//>
        <div class="nav-section">Security</div>
        <${NavLink} href="#/security/rules">Rules<//>
        <${NavLink} href="#/security/pending">Pending<//>
        <${NavLink} href="#/security/audit">Audit<//>
        <${NavLink} href="#/security/legislator">Legislator<//>
        <${NavLink} href="#/security/rule-changes">Rule Changes<//>
        ${authState.required ? html`
          <div style="position:absolute; bottom:16px; left:16px; right:16px">
            <button class="btn-sm" style="width:100%" onClick=${logout}>Logout</button>
          </div>
        ` : null}
      </nav>
      <main class="content"><${Page} /></main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
