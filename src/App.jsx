import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const ORANGE = "#E9642B";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";
const PURPLE_BORDER = "#5D4976";

const DRIVER_NAMES = ["Rustamjon", "Botirjon", "Sardorbek", "Aziz", "Farrux"];

function fmt(n) { return "$" + (Number(n) || 0).toLocaleString("en-US"); }
function formatDate(iso) {
  try { return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [driverName, setDriverName] = useState("");
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
    const { data } = await supabase.from("drivers").select("name").eq("auth_user_id", s.user.id).maybeSingle();
    setDriverName(data?.name || s.user.email.split("@")[0]);
    setLoading(false);
  }

  const refresh = useCallback(async () => {
    if (!session) return;
    const { data: avail } = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*), customers(name, viloyat, manzil, delivery_lat, delivery_lng, phone)")
      .eq("status", "yigilmoqda")
      .order("created_at", { ascending: true });
    setAvailable(avail || []);

    const { data: mineData } = await supabase
      .from("buyurtmalar")
      .select("*, buyurtma_items(*), customers(name, viloyat, manzil, delivery_lat, delivery_lng, phone)")
      .eq("status", "yolda")
      .eq("driver_name", driverName)
      .order("created_at", { ascending: true });
    setMine(mineData || []);
  }, [session, driverName]);

  useEffect(() => {
    if (!session || !driverName) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [session, driverName, refresh]);

  async function doLogin() {
    if (!loginName) { setLoginError("Ismingizni tanlang"); return; }
    setBusy(true);
    const email = `${loginName.toLowerCase()}@marba-driver.internal`;
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
    await supabase.from("buyurtmalar").update({ status: "yolda", driver_name: driverName }).eq("id", order.id);
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
            <div style={{ fontWeight: 900, fontStyle: "italic", fontSize: 16, color: "#fff" }}>MARBA DRIVERS</div>
            <div style={{ fontSize: 12, color: "#9FB0CC", marginTop: 2 }}>{driverName}</div>
          </div>
          <button onClick={doLogout} style={styles.logoutBtn}>Chiqish</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
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
        </div>
      </div>
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
};