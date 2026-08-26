import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

const ORANGE = "#E9642B";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";
const PURPLE_BORDER = "#5D4976";

const DRIVER_NAMES = ["Musoxon", "Alimardon", "Lazizxon", "Bilolxon", "Oybek", "Oybek Yangi", "Rustamjon", "Ruzmatjon", "Akramjon"];

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
  return (s || "").toLowerCase().replace(/['\u2018\u2019]/g, "'").trim();
}
function matchesProvince(customerViloyat, province) {
  return normalize(customerViloyat).includes(normalize(province));
}
function matchesZone(customerViloyat, zoneName) {
  const provinces = ZONE_PROVINCES[zoneName] || [];
  return provinces.some(function (p) { return matchesProvince(customerViloyat, p); });
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

  const watchIdRef = useRef(null);
  const lastCoordsRef = useRef(null);

  useEffect(function () {
    supabase.auth.getSession().then(function (res) {
      if (res.data.session) initDriver(res.data.session);
      else setLoading(false);
    });
    const sub = supabase.auth.onAuthStateChange(function (_e, s) {
      if (s) initDriver(s);
      else { setSession(null); setDriverName(""); setIsAdmin(false); }
    });
    return function () { sub.data.subscription.unsubscribe(); };
  }, []);

  async function initDriver(s) {
    setSession(s);
    const res = await supabase
      .from("drivers")
      .select("name, phone, hudud, viloyat, on_route, route_km, is_admin")
      .eq("auth_user_id", s.user.id)
      .maybeSingle();
    const data = res.data;
    setDriverName((data && data.name) || s.user.email.split("@")[0]);
    setDriverPhone((data && data.phone) || "");
    setDriverZone((data && data.hudud) || "");
    setDriverViloyat((data && data.viloyat) || "");
    setIsAdmin(!!(data && data.is_admin));
    setOnRoute(!!(data && data.on_route));
    setRouteKm(Number(data && data.route_km) || 0);
    setLoading(false);
  }

  async function savePhone(newPhone) {
    const res = await supabase.from("drivers").update({ phone: newPhone }).eq("auth_user_id", session.user.id);
    if (res.error) { alert("Saqlashda xatolik: " + res.error.message); return; }
    setDriverPhone(newPhone);
  }

  async function saveZone(zone) {
    const res = await supabase.from("drivers").update({ hudud: zone, viloyat: null }).eq("auth_user_id", session.user.id);
    if (res.error) { alert("Saqlashda xatolik: " + res.error.message); return; }
    setDriverZone(zone);
    setDriverViloyat("");
  }

  async function saveViloyat(viloyat) {
    const res = await supabase.from("drivers").update({ viloyat: viloyat }).eq("auth_user_id", session.user.id);
    if (res.error) { alert("Saqlashda xatolik: " + res.error.message); return; }
    setDriverViloyat(viloyat);
  }

  function startRoute() {
    if (!navigator.geolocation) { alert("Bu qurilmada joylashuv xizmati mavjud emas"); return; }
    lastCoordsRef.current = null;
    setRouteKm(0);
    setOnRoute(true);
    supabase.from("drivers").update({ on_route: true, route_km: 0 }).eq("auth_user_id", session.user.id);

    watchIdRef.current = navigator.geolocation.watchPosition(
      function (pos) {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        setRouteKm(function (prevKm) {
          let newKm = prevKm;
          if (lastCoordsRef.current) {
            const delta = haversineKm(lastCoordsRef.current.lat, lastCoordsRef.current.lng, latitude, longitude);
            if (delta > 0.01 && delta < 2) newKm = prevKm + delta;
          }
          lastCoordsRef.current = { lat: latitude, lng: longitude };
          supabase.from("drivers").update({
            current_lat: latitude,
            current_lng: longitude,
            route_km: newKm,
            last_ping_at: new Date().toISOString(),
          }).eq("auth_user_id", session.user.id);
          return newKm;
        });
      },
      function (err) { console.error("geolocation error", err); },
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

  async function attachCustomers(orders) {
    const list = orders || [];
    const idSet = {};
    list.forEach(function (o) { if (o.customer_id) idSet[o.customer_id] = true; });
    const ids = Object.keys(idSet);
    if (ids.length === 0) return list;
    const res = await supabase
      .from("customers")
      .select("id, name, viloyat, manzil, delivery_lat, delivery_lng, phone")
      .in("id", ids);
    const map = {};
    (res.data || []).forEach(function (c) { map[c.id] = c; });
    return list.map(function (o) { return Object.assign({}, o, { customers: map[o.customer_id] }); });
  }

  const refresh = useCallback(async function () {
    if (!session) return;
    const availRes = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*)")
      .eq("status", "yigilmoqda")
      .order("created_at", { ascending: true });
    if (availRes.error) console.error("avail error", availRes.error);
    const availWithCustomers = await attachCustomers(availRes.data);
    let filteredAvail = availWithCustomers;
    if (driverViloyat) {
      filteredAvail = availWithCustomers.filter(function (o) { return matchesProvince(o.customers && o.customers.viloyat, driverViloyat); });
    } else if (driverZone) {
      filteredAvail = availWithCustomers.filter(function (o) { return matchesZone(o.customers && o.customers.viloyat, driverZone); });
    }
    setAvailable(filteredAvail);

    const mineRes = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*)")
      .eq("status", "yolda")
      .eq("driver_name", driverName)
      .order("created_at", { ascending: true });
    if (mineRes.error) console.error("mine error", mineRes.error);
    setMine(await attachCustomers(mineRes.data));
  }, [session, driverName, driverZone, driverViloyat]);

  useEffect(function () {
    if (!session || !driverName) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return function () { clearInterval(interval); };
  }, [session, driverName, refresh]);

  async function doLogin() {
    if (!loginName) { setLoginError("Ismingizni tanlang"); return; }
    setBusy(true);
    const slug = loginName.toLowerCase().replace(/\s+/g, "");
    const email = slug + "@marba-driver.internal";
    const res = await supabase.auth.signInWithPassword({ email: email, password: loginPass });
    setBusy(false);
    if (res.error) { setLoginError("Parol noto'g'ri"); return; }
    setLoginPass("");
    setLoginError("");
  }
  async function doLogout() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
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
              {DRIVER_NAMES.map(function (n) {
                return (
                  <button key={n} onClick={function () { setLoginName(n); setLoginError(""); }}
                    style={Object.assign({}, styles.nameBtn, { background: loginName === n ? ORANGE : DARK_BLUE_LIGHT })}>{n}</button>
                );
              })}
            </div>
            <div style={{ color: "#9FB0CC", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Parol</div>
            <input type="password" style={styles.input} value={loginPass} onChange={function (e) { setLoginPass(e.target.value); }}
              onKeyDown={function (e) { if (e.key === "Enter") doLogin(); }} placeholder="Parolni kiriting" />
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
              onClick={function () {
                const val = window.prompt("Telefon raqamingizni kiriting:", driverPhone);
                if (val !== null) savePhone(val.trim());
              }}
              style={{ cursor: "pointer" }}
            >
              <div style={{ fontWeight: 900, fontStyle: "italic", fontSize: 15, color: "#fff" }}>MARBA DRIVERS</div>
              <div style={{ fontSize: 11.5, color: "#9FB0CC", marginTop: 2 }}>
                {driverName}{driverPhone ? " \u2022 " + driverPhone : " \u2022 telefon kiritish uchun bosing"}
                {isAdmin ? " \u2022 ADMIN" : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <select
                value={driverZone}
                onChange={function (e) { saveZone(e.target.value); }}
                style={{ background: DARK_BLUE_LIGHT, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, fontWeight: 700 }}
              >
                <option value="">Hudud tanlanmagan</option>
                {ZONE_NAMES.map(function (z) { return <option key={z} value={z}>{z}</option>; })}
              </select>
              {driverZone && (ZONE_PROVINCES[driverZone] || []).length > 1 && (
                <select
                  value={driverViloyat}
                  onChange={function (e) { saveViloyat(e.target.value); }}
                  style={{ background: DARK_BLUE_LIGHT, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, fontWeight: 700 }}
                >
                  <option value="">Barcha viloyatlar</option>
                  {ZONE_PROVINCES[driverZone].map(function (v) { return <option key={v} value={v}>{v}</option>; })}
                </select>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={function () {
                  if (!isAdmin) { alert("Bu bolim faqat admin uchun"); return; }
                  setView(view === "admin" ? "orders" : "admin");
                }}
                style={styles.logoutBtn}
              >
                {view === "admin" ? "Buyurtmalar" : "Admin"}
              </button>
              <button onClick={doLogout} style={styles.logoutBtn}>Chiqish</button>
            </div>
            {onRoute ? (
              <button onClick={endRoute} style={styles.routeBtnActive}>Yolni tugatdim ({routeKm.toFixed(1)} km)</button>
            ) : (
              <button onClick={startRoute} style={styles.routeBtn}>Yolga chiqdim</button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {view === "admin" ? (
            <AdminPanel />
          ) : (
            <React.Fragment>
              {mine.length > 0 && (
                <React.Fragment>
                  <div style={styles.sectionTitle}>Yetkazayotganlarim ({mine.length})</div>
                  {mine.map(function (o) {
                    return <OrderCard key={o.id} order={o} action={{ label: "Yetkazildi", onPress: function () { markDelivered(o); }, busy: busyId === o.id }} />;
                  })}
                </React.Fragment>
              )}

              <div style={styles.sectionTitle}>Yig'ilgan buyurtmalar ({available.length})</div>
              {available.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9FB0CC", padding: "24px 0", fontSize: 13 }}>Hozircha buyurtma yo'q.</div>
              ) : available.map(function (o) {
                return <OrderCard key={o.id} order={o} action={{ label: "Yuklab oldim", onPress: function () { acceptOrder(o); }, busy: busyId === o.id }} />;
              })}
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminPanel() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(function () {
    load();
    const interval = setInterval(load, 15000);
    return function () { clearInterval(interval); };
  }, []);

  async function load() {
    const res = await supabase.from("drivers").select("*").order("name");
    setDrivers(res.data || []);
    setLoading(false);
  }

  if (loading) return <div style={{ color: "#9FB0CC", textAlign: "center", padding: 24 }}>Yuklanmoqda...</div>;

  return (
    <div>
      <div style={styles.sectionTitle}>Haydovchilar holati</div>
      {drivers.map(function (d) {
        const mapHref = d.current_lat && d.current_lng
          ? "https://yandex.uz/maps/?pt=" + d.current_lng + "," + d.current_lat + "&z=15&l=map"
          : null;
        return (
          <div key={d.id} style={styles.adminCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d.name}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: d.on_route ? "#2c7a4b" : "#8a887e" }}>
                {d.on_route ? "Yolda" : "Yolda emas"}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#8a887e", marginBottom: 3 }}>
              {d.phone || "tel yoq"} {d.hudud ? "- " + d.hudud + (d.viloyat ? " (" + d.viloyat + ")" : "") : ""}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Masofa: {Number(d.route_km || 0).toFixed(1)} km
            </div>
            {mapHref ? (
              <a href={mapHref} target="_blank" rel="noreferrer" style={styles.smallBtnGhost}>Xaritada korish</a>
            ) : (
              <div style={{ fontSize: 10.5, color: "#8a887e" }}>Joylashuv hali yoq</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OrderCard(props) {
  const order = props.order;
  const action = props.action;
  const c = order.customers;
  const total = (order.buyurtma_items || []).reduce(function (s, it) { return s + it.price * it.qty; }, 0);
  const mapUrl = c && c.delivery_lat && c.delivery_lng
    ? "https://yandex.uz/maps/?pt=" + c.delivery_lng + "," + c.delivery_lat + "&z=16&l=map"
    : null;
  const itemsText = (order.buyurtma_items || []).map(function (it) { return it.product_name + " x" + it.qty; }).join(", ");

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>#{order.order_no} - {(c && c.name) || "Noma'lum"}</div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt(total)}</div>
      </div>
      <div style={{ fontSize: 11, color: "#8a887e", marginBottom: 2 }}>
        {(c && c.viloyat) || ""}{c && c.manzil ? ", " + c.manzil : ""}
      </div>
      <div style={{ fontSize: 11.5, marginBottom: 4, color: "#333" }}>{itemsText}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {c && c.phone && <a href={"tel:" + c.phone} style={styles.smallBtnGhost}>Qongiroq</a>}
        {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" style={styles.smallBtnGhost}>Xarita</a>}
      </div>
      <button onClick={action.onPress} disabled={action.busy} style={styles.actionBtn}>
        {action.busy ? "..." : action.label}
      </button>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#000", display: "flex", justifyContent: "center" },
  frame: { width: "100%", maxWidth: 430, minHeight: "100vh", background: DARK_BLUE, display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" },
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: DARK_BLUE },
  header: { padding: "14px 14px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + DARK_BLUE_LIGHT },
  logoutBtn: { background: "transparent", border: "1px solid " + DARK_BLUE_LIGHT, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 11.5, cursor: "pointer" },
  sectionTitle: { color: "#9FB0CC", fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", margin: "10px 0 6px" },
  card: { background: "#fff", borderRadius: 10, padding: 9, marginBottom: 7 },
  adminCard: { background: "#fff", borderRadius: 10, padding: 10, marginBottom: 8 },
  smallBtnGhost: { flex: 1, textAlign: "center", background: "#f3f2ec", borderRadius: 7, padding: "5px 0", fontSize: 11, fontWeight: 700, color: "#161615", textDecoration: "none" },
  actionBtn: { width: "100%", background: ORANGE, color: "#fff", border: "none", borderRadius: 8, padding: 8, fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  nameBtn: { border: "none", borderRadius: 8, color: "#fff", fontSize: 13, padding: "10px 8px", cursor: "pointer", fontWeight: 700 },
  input: { width: "100%", padding: "12px 14px", border: "1.5px solid " + PURPLE_BORDER, borderRadius: 8, fontSize: 14, background: DARK_BLUE_LIGHT, color: "#fff" },
  loginBtn: { width: "100%", background: ORANGE, color: "#fff", border: "none", borderRadius: 10, padding: 14, fontWeight: 700, fontSize: 15, marginTop: 16, cursor: "pointer" },
  routeBtn: { background: ORANGE, color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" },
  routeBtnActive: { background: "#a1281f", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" },
};