import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const ORANGE = "#E9642B";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";
const PURPLE_BORDER = "#5D4976";

const DRIVER_NAMES = ["Musoxon", "Alimardon", "Lazizxon", "Bilolxon", "Oybek", "Oybek Yangi", "Rustamjon", "Ruzmatjon"];

const ZONE_PROVINCES = {
  "Vodiy": ["Farg'ona", "Andijon", "Namangan"],
  "Voha": ["Xorazm", "Buxoro", "Navoiy"],
  "Toshkent": ["Toshkent"],
  "Markaziy": ["Samarqand", "Jizzax", "Sirdaryo"],
  "Janubiy": ["Qashqadaryo", "Surxondaryo"],
  "Qoraqalpog'iston": ["Qoraqalpog'iston"],
};
const ZONE_NAMES = Object.keys(ZONE_PROVINCES);

function normalize(s) {
  return (s || "").toLowerCase().replace(/['‘’]/g, "'").trim();
}
function matchesProvince(customerViloyat, province) {
  return normalize(customerViloyat).includes(normalize(province));
}
function matchesZone(customerViloyat, zoneName) {
  const provinces = ZONE_PROVINCES[zoneName] || [];
  return provinces.some((p) => matchesProvince(customerViloyat, p));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function fmt(n) { return "$" + (Number(n) || 0).toLocaleString("en-US"); }
function formatDate(iso) {
  try { return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverZone, setDriverZone] = useState("");
  const [driverViloyat, setDriverViloyat] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [onRoute, setOnRoute] = useState(false);
  const [routeKm, setRouteKm] = useState(0);
  const [view, setView] = useState("orders");
  const [loading, setLoading] = useState(true);
  const [loginName, setLoginName] = useState(null);
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);

  const [available, setAvailable] = useState([]);
  const [mine, setMine] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) initDriver(data.session); else setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (s) initDriver(s); else { setSession(null); setDriverName(""); } });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function initDriver(s) {
    setSession(s);
    const { data } = await supabase.from("drivers").select("name, phone, hudud, viloyat, on_route, route_km, is_admin").eq("auth_user_id", s.user.id).maybeSingle();
    setDriverName(data?.name || s.user.email.split("@")[0]);
    setDriverPhone(data?.phone || "");
    setDriverZone(data?.hudud || "");
    setDriverViloyat(data?.viloyat || "");
    setIsAdmin(data?.is_admin || false);
    setOnRoute(data?.on_route || false);
    setRouteKm(Number(data?.route_km) || 0);
    setLoading(false);
  }

  async function saveZone(zone) {
    await supabase.from("drivers").update({ hudud: zone, viloyat: null }).eq("auth_user_id", session.user.id);
    setDriverZone(zone);
    setDriverViloyat("");
  }

  async function saveViloyat(viloyat) {
    await supabase.from("drivers").update({ viloyat }).eq("auth_user_id", session.user.id);
    setDriverViloyat(viloyat);
  }

  const watchIdRef = React.useRef(null);
  const lastCoordsRef = React.useRef(null);

  function startRoute() {
    if (!navigator.geolocation) { alert("Bu qurilmada joylashuv xizmati mavjud emas"); return; }
    lastCoordsRef.current = null;
    setRouteKm(0);
    setOnRoute(true);
    supabase.from("drivers").update({ on_route: true, route_km: 0 }).eq("auth_user_id", session.user.id);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        setRouteKm((prevKm) => {
          let newKm = prevKm;
          if (lastCoordsRef.current) {
            const delta = haversineKm(lastCoordsRef.current.lat, lastCoordsRef.current.lng, latitude, longitude);
            if (delta > 0.01 && delta < 2) newKm = prevKm + delta;
          }
          lastCoordsRef.current = { lat: latitude, lng: longitude };
          supabase.from("drivers").update({
            current_lat: latitude, current_lng: longitude, route_km: newKm, last_ping_at: new Date().toISOString(),
          }).eq("auth_user_id", session.user.id);
          return newKm;
        });
      },
      (err) => console.error("geolocation error", err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function endRoute() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setOnRoute(false);
    supabase.from("drivers").update({ on_route: false }).eq("auth_user_id", session.user.id);
  }

  async function savePhone(newPhone) {
    const { error } = await supabase.from("drivers").update({ phone: newPhone }).eq("auth_user_id", session.user.id);
    if (error) { alert("Saqlashda xatolik: " + error.message); return; }
    setDriverPhone(newPhone);
  }

  async function attachCustomers(orders) {
    const ids = [...new Set((orders || []).map((o) => o.customer_id).filter(Boolean))];
    if (ids.length === 0) return orders || [];
    const { data: custs } = await supabase
      .from("customers")
      .select("id, name, viloyat, manzil, delivery_lat, delivery_lng, phone")
      .in("id", ids);
    const map = {};
    (custs || []).forEach((c) => { map[c.id] = c; });
    return (orders || []).map((o) => ({ ...o, customers: map[o.customer_id] }));
  }

  const refresh = useCallback(async () => {
    if (!session) return;
    const { data: avail, error: availErr } = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*)")
      .eq("status", "yigilmoqda")
      .order("created_at", { ascending: true });
    if (availErr) console.error("avail error", availErr);
    const availWithCustomers = await attachCustomers(avail);
    let filteredAvail = availWithCustomers;
    if (driverViloyat) {
      filteredAvail = availWithCustomers.filter((o) => matchesProvince(o.customers?.viloyat, driverViloyat));
    } else if (driverZone) {
      filteredAvail = availWithCustomers.filter((o) => matchesZone(o.customers?.viloyat, driverZone));
    }
    setAvailable(filteredAvail);

    const { data: mineData, error: mineErr } = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*)")
      .eq("status", "yolda")
      .eq("driver_name", driverName)
      .order("created_at", { ascending: true });
    if (mineErr) console.error("mine error", mineErr);
    setMine(await attachCustomers(mineData));
  }, [session, driverName, driverZone, driverViloyat]);

  useEffect(() => {
    if (!session || !driverName) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [session, driverName, refresh]);

  async function doLogin() {
    if (!loginName) { setLoginError("Ismingizni tanlang"); return; }
    setBusy(true);
    const email = `${loginName.toLowerCase().replace(/\s+/g, "")}@marba-driver.internal`;
    const { error } = await supabase.auth.signInWithPassword({ email, password: loginPass });
    setBusy(false);
    if (error) { setLoginError("Parol noto'g'ri"); return; }
    setLoginPass(""); setLoginError("");
  }
  async function doLogout() {
    await supabase.auth.signOut();
  }

  async function acceptOrder(order) {
    setBusyId(order.id);
    await supabase.from("buyurtmalar").update({ status: "yolda", driver_name: driverName, driver_phone: driverPhone }).eq("id", order.id);
    setBusyId(null);
    refresh();
  }

  async function markDelivered(order) {
    setBusyId(order.id);
    await supabase.from("buyurtmalar").update({ status: "yetkazildi" }).eq("id", order.id);
    setBusyId(null);
    refresh();
  }

  if (loading) {
    return <div style={styles.center}><div style={{ color: "#fff" }}>Yuklanmoqda...</div></div>;
  }

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.frame}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ fontWeight: 900, fontStyle: "italic", fontSize: 26, color: "#fff", letterSpacing: 1 }}>MARBA</div>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#9FB0CC", fontWeight: 700 }}>DRIVERS</div>
            </div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Ismingizni tanlang</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
              {DRIVER_NAMES.map((n) => (
                <button key={n} onClick={() => { setLoginName(n); setLoginError(""); }}
                  style={{ ...styles.nameBtn, background: loginName === n ? ORANGE : DARK_BLUE_LIGHT }}>{n}</button>
              ))}
            </div>
            <div style={{ color: "#9FB0CC", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Parol</div>
            <input type="password" style={styles.input} value={loginPass} onChange={(e) => setLoginPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()} placeholder="Parolni kiriting" />
            {loginError && <div style={{ color: "#f0837f", fontSize: 13, marginTop: 10 }}>{loginError}</div>}
            <button onClick={doLogin} disabled={busy} style={styles.loginBtn}>{busy ? "..." : "Kirish"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.frame}>
        <div style={styles.header}>
          <div>
            <div
              onClick={() => {
                const val = window.prompt("Telefon raqamingizni kiriting:", driverPhone);
                if (val !== null) savePhone(val.trim());
              }}
              style={{ cursor: "pointer" }}
            >
              <div style={{ fontWeight: 900, fontStyle: "italic", fontSize: 16, color: "#fff" }}>MARBA DRIVERS</div>
              <div style={{ fontSize: 12, color: "#9FB0CC", marginTop: 2 }}>{driverName}{driverPhone ? ` • ${driverPhone}` : " • telefon kiritish uchun bosing"}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <select
                value={driverZone}
                onChange={(e) => saveZone(e.target.value)}
                style={{ background: DARK_BLUE_LIGHT, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 700 }}
              >
                <option value="">Hudud tanlanmagan</option>
                {ZONE_NAMES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              {driverZone && (ZONE_PROVINCES[driverZone] || []).length > 1 && (
                <select
                  value={driverViloyat}
                  onChange={(e) => saveViloyat(e.target.value)}
                  style={{ background: DARK_BLUE_LIGHT, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 700 }}
                >
                  <option value="">Barcha viloyatlar</option>
                  {ZONE_PROVINCES[driverZone].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {isAdmin && (
                <button onClick={() => setView(view === "admin" ? "orders" : "admin")} style={styles.logoutBtn}>
                  {view === "admin" ? "Buyurtmalar" : "Admin"}
                </button>
              )}
              <button onClick={doLogout} style={styles.logoutBtn}>Chiqish</button>
            </div>
            {onRoute ? (
              <button onClick={endRoute} style={styles.routeBtnActive}>Yolni tugatdim ({routeKm.toFixed(1)} km)</button>
            ) : (
              <button onClick={startRoute} style={styles.routeBtn}>Yolga chiqdim</button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {view === "admin" ? (
            <AdminPanel />
          ) : (
            <>
              {mine.length > 0 && (
                <>
                  <div style={styles.sectionTitle}>Yetkazayotganlarim ({mine.length})</div>
                  {mine.map((o) => <OrderCard key={o.id} order={o} action={{ label: "Yetkazildi", onPress: () => markDelivered(o), busy: busyId === o.id }} />)}
                </>
              )}

              <div style={styles.sectionTitle}>Yig'ilgan buyurtmalar ({available.length})</div>
              {available.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9FB0CC", padding: "30px 0", fontSize: 13.5 }}>Hozircha buyurtma yo'q.</div>
              ) : available.map((o) => <OrderCard key={o.id} order={o} action={{ label: "Yuklab oldim", onPress: () => acceptOrder(o), busy: busyId === o.id }} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminPanel() {
  const [drivers, setDrivers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    const { data } = await supabase.from("drivers").select("*").order("name");
    setDrivers(data || []);
    setLoading(false);
  }

  if (loading) return <div style={{ color: "#9FB0CC", textAlign: "center", padding: 30 }}>Yuklanmoqda...</div>;

  return (
    <div>
      <div style={styles.sectionTitle}>Haydovchilar holati</div>
      {drivers.map((d) => (
        <div key={d.id} style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontWeight: 700 }}>{d.name}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: d.on_route ? "#2c7a4b" : "#8a887e" }}>
              {d.on_route ? "Yolda" : "Yolda emas"}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "#8a887e", marginBottom: 4 }}>
            {d.phone || "tel yoq"} {d.hudud ? "- " + d.hudud + (d.viloyat ? " (" + d.viloyat + ")" : "") : ""}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Joriy masofa: {Number(d.route_km || 0).toFixed(1)} km
          </div>
          {d.current_lat && d.current_lng ? (
            <a
              href={"https://yandex.uz/maps/?pt=" + d.current_lng + "," + d.current_lat + "&z=15&l=map"}
              target="_blank" rel="noreferrer"
              style={styles.smallBtnGhost}
            >
              Xaritada korish
            </a>
          ) : (
            <div style={{ fontSize: 11.5, color: "#8a887e" }}>Joylashuv hali yoq</div>
          )}
          {d.last_ping_at && (
            <div style={{ fontSize: 10.5, color: "#8a887e", marginTop: 4 }}>
              Yangilangan: {new Date(d.last_ping_at).toLocaleTimeString("uz-UZ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OrderCard({ order, action }) {
  const c = order.customers;
  const total = (order.buyurtma_items || []).reduce((s, it) => s + it.price * it.qty, 0);
  const mapUrl = c?.delivery_lat && c?.delivery_lng ? `https://yandex.uz/maps/?pt=${c.delivery_lng},${c.delivery_lat}&z=16&l=map` : null;
  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontWeight: 700 }}>#{order.order_no} — {c?.name || "Noma'lum"}</div>
        <div style={{ fontWeight: 700 }}>{fmt(total)}</div>
      </div>
      <div style={{ fontSize: 12.5, color: "#8a887e", marginBottom: 6 }}>{c?.viloyat}{c?.manzil ? `, ${c.manzil}` : ""}</div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>{(order.buyurtma_items || []).map((it) => `${it.product_name} x${it.qty}`).join(", ")}</div>
      <div style={{ fontSize: 11.5, color: "#8a887e", marginBottom: 10 }}>{formatDate(order.created_at)}{order.packed_by ? ` • Yig'di: ${order.packed_by}` : ""}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {c?.phone && <a href={`tel:${c.phone}`} style={styles.smallBtnGhost}>📞 Qo'ng'iroq</a>}
        {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" style={styles.smallBtnGhost}>📍 Xarita</a>}
      </div>
      <button onClick={action.onPress} disabled={action.busy} style={styles.actionBtn}>{action.busy ? "..." : action.label}</button>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#000", display: "flex", justifyContent: "center" },
  frame: { width: "100%", maxWidth: 430, minHeight: "100vh", background: DARK_BLUE, display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: DARK_BLUE },
  header: { padding: "18px 18px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${DARK_BLUE_LIGHT}` },
  logoutBtn: { background: "transparent", border: `1px solid ${DARK_BLUE_LIGHT}`, color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" },
  sectionTitle: { color: "#9FB0CC", fontWeight: 700, fontSize: 12.5, letterSpacing: 1, textTransform: "uppercase", margin: "16px 0 10px" },
  card: { background: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 },
  smallBtnGhost: { flex: 1, textAlign: "center", background: "#f3f2ec", borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 700, color: "#161615", textDecoration: "none" },
  actionBtn: { width: "100%", background: ORANGE, color: "#fff", border: "none", borderRadius: 10, padding: 13, fontWeight: 700, fontSize: 14, marginTop: 10, cursor: "pointer" },
  nameBtn: { border: "none", borderRadius: 8, color: "#fff", fontSize: 13, padding: "10px 8px", cursor: "pointer", fontWeight: 700 },
  input: { width: "100%", padding: "12px 14px", border: `1.5px solid ${PURPLE_BORDER}`, borderRadius: 8, fontSize: 14, background: DARK_BLUE_LIGHT, color: "#fff" },
  loginBtn: { width: "100%", background: ORANGE, color: "#fff", border: "none", borderRadius: 10, padding: 14, fontWeight: 700, fontSize: 15, marginTop: 16, cursor: "pointer" },
  routeBtn: { background: ORANGE, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  routeBtnActive: { background: "#a1281f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
};