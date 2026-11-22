package com.baelinc.fppcentralhub

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class HubViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("hub", 0)

    var hubUrl by mutableStateOf(prefs.getString("url", "") ?: "")
    var kioskMode by mutableStateOf(prefs.getBoolean("kiosk", false))
    var connected by mutableStateOf(false)
    var connecting by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var busy by mutableStateOf<Set<String>>(emptySet())
    var devices by mutableStateOf<List<Device>>(emptyList())
    var statuses by mutableStateOf<Map<String, Status>>(emptyMap())
    var scenes by mutableStateOf<List<Scene>>(emptyList())
    var refreshSeconds by mutableStateOf(5)
    var version by mutableStateOf("")
    var readOnly by mutableStateOf(false)
    var playlists by mutableStateOf<Map<String, List<String>>>(emptyMap())
    var events by mutableStateOf<List<String>?>(null)

    private var api: HubApi? = null
    private var poller: Job? = null

    init {
        if (hubUrl.isNotBlank()) connect()
    }

    fun say(m: String) { message = m }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    fun connect(url: String = hubUrl) {
        if (url.isBlank()) { error = "Enter the address of your Hub (for example 192.168.1.10)"; return }
        connecting = true
        error = null
        viewModelScope.launch {
            try {
                val a = HubApi(url, kioskMode)
                val j = io { a.call("bootstrap") }
                api = a
                hubUrl = a.base
                prefs.edit().putString("url", a.base).putBoolean("kiosk", kioskMode).apply()
                applyConfig(j.optJSONObject("config") ?: JSONObject())
                version = j.optString("version")
                connected = true
                startPolling()
            } catch (e: Exception) {
                error = e.message ?: "Could not connect"
                connected = false
            } finally {
                connecting = false
            }
        }
    }

    fun disconnect() {
        poller?.cancel()
        connected = false
        api = null
        devices = emptyList(); statuses = emptyMap(); scenes = emptyList()
        prefs.edit().remove("url").apply()
        hubUrl = ""
    }

    private fun applyConfig(cfg: JSONObject) {
        devices = cfg.optJSONArray("devices").objects().map(::parseDevice).filter { !it.hidden }
        scenes = cfg.optJSONArray("scenes").objects().map(::parseScene)
        val o = cfg.optJSONObject("options")
        refreshSeconds = (o?.optInt("refreshSeconds", 5) ?: 5).coerceIn(2, 300)
        readOnly = kioskMode && (o?.optBoolean("kioskReadOnly", false) ?: false)
    }

    private fun startPolling() {
        poller?.cancel()
        poller = viewModelScope.launch {
            while (isActive) {
                refreshStatus()
                delay(refreshSeconds * 1000L)
            }
        }
    }

    suspend fun refreshStatus() {
        val a = api ?: return
        try {
            val j = io { a.call("status") }
            val st = j.optJSONObject("status")
            if (st != null) {
                val m = HashMap<String, Status>()
                for (k in st.keys()) st.optJSONObject(k)?.let { m[k] = parseStatus(it) }
                statuses = m
            }
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }

    fun reload() {
        val a = api ?: return
        viewModelScope.launch {
            try {
                val j = io { a.call("bootstrap") }
                applyConfig(j.optJSONObject("config") ?: JSONObject())
                refreshStatus()
            } catch (e: Exception) { error = e.message }
        }
    }

    /** Run one device command. Returns the reply (or null on failure). */
    suspend fun actNow(d: Device, cmd: String, args: JSONObject = JSONObject(), quiet: Boolean = false): JSONObject? {
        val a = api ?: return null
        busy = busy + d.id
        try {
            val j = io { a.act(d.id, cmd, args) }
            if (!quiet) say(j.optString("msg").ifEmpty { "Done" })
            j.optJSONObject("status")?.let { statuses = statuses + (d.id to parseStatus(JSONObject().put("online", true).put("detail", it))) }
            return j
        } catch (e: Exception) {
            say(d.name + ": " + (e.message ?: "failed"))
            return null
        } finally {
            busy = busy - d.id
        }
    }

    fun act(d: Device, cmd: String, args: JSONObject = JSONObject(), refresh: Boolean = true) {
        viewModelScope.launch {
            actNow(d, cmd, args)
            if (refresh) refreshStatus()
        }
    }

    fun loadPlaylists(d: Device) {
        if (playlists.containsKey(d.id)) return
        viewModelScope.launch {
            val j = actNow(d, "playlists", quiet = true)
            val arr = j?.optJSONArray("data")
            val list = ArrayList<String>()
            if (arr != null) for (i in 0 until arr.length()) list.add(arr.optString(i))
            playlists = playlists + (d.id to list)
        }
    }

    fun lightsOffAll() {
        viewModelScope.launch {
            val targets = devices.filter { (it.kind == "fpp" || (it.kind == "controller" && it.type == "wled")) && statuses[it.id]?.online == true }
            if (targets.isEmpty()) { say("No online controllers"); return@launch }
            var bad = 0
            for (d in targets) if (actNow(d, "lights_off", quiet = true) == null) bad++
            say(if (bad == 0) "Lights off sent to ${targets.size} controller(s)" else "Lights off: $bad failed")
            refreshStatus()
        }
    }

    fun runScene(s: Scene) {
        viewModelScope.launch {
            say("Running \"${s.name}\"…")
            var bad = 0
            for (st in s.steps) {
                val d = devices.firstOrNull { it.id == st.device }
                if (d == null) { bad++; continue }
                if (actNow(d, st.cmd, st.args, quiet = true) == null) bad++
                if (st.delay > 0) delay(st.delay * 1000L)
            }
            say("\"${s.name}\" finished" + if (bad > 0) " with $bad error(s)" else "")
            refreshStatus()
        }
    }

    fun scan(kind: String) {
        val a = api ?: return
        viewModelScope.launch {
            say("Scanning for $kind devices… this can take a moment")
            try {
                val j = io { a.call("scan", JSONObject().put("kind", kind)) }
                val added = j.optJSONArray("added")?.length() ?: 0
                say("Scan finished: $added new device(s)")
                reload()
            } catch (e: Exception) { say(e.message ?: "Scan failed") }
        }
    }

    fun loadEvents() {
        val a = api ?: return
        viewModelScope.launch {
            try {
                val j = io { a.call("events") }
                val arr = j.optJSONArray("events")
                val out = ArrayList<String>()
                if (arr != null) for (i in 0 until arr.length()) {
                    val e = arr.optJSONObject(i) ?: continue
                    val t = java.text.SimpleDateFormat("MMM d HH:mm", java.util.Locale.getDefault()).format(java.util.Date(e.optLong("t") * 1000))
                    out.add(t + "  " + e.optString("msg"))
                }
                events = out
            } catch (e: Exception) { say(e.message ?: "Could not load events") }
        }
    }

    fun setKiosk(v: Boolean) {
        kioskMode = v
        prefs.edit().putBoolean("kiosk", v).apply()
        if (connected) connect()
    }
}
