package com.baelinc.fppcentralhub

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

private val Bg = Color(0xFF0F1722)
private val Card = Color(0xFF182231)
private val Accent = Color(0xFFFFC83D)
private val Good = Color(0xFF3DDC97)
private val Bad = Color(0xFFFF6B6B)
private val Muted = Color(0xFF9AA7B8)

class MainActivity : ComponentActivity() {
    private val vm: HubViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Bg, surface = Card, onPrimary = Color.Black)) {
                Surface(Modifier.fillMaxSize(), color = Bg) {
                    if (vm.connected) Dashboard(vm) else ConnectScreen(vm)
                }
            }
        }
    }
}

@Composable
fun ConnectScreen(vm: HubViewModel) {
    var url by remember { mutableStateOf(vm.hubUrl) }
    Column(
        Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Hub, null, tint = Accent, modifier = Modifier.size(72.dp))
        Spacer(Modifier.height(8.dp))
        Text("FPP Central Hub", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text("Connect to the Hub running on one of your FPP controllers.", color = Muted)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = url, onValueChange = { url = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text("Hub address") }, placeholder = { Text("192.168.1.10") },
        )
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Switch(checked = vm.kioskMode, onCheckedChange = { vm.kioskMode = it })
            Spacer(Modifier.width(8.dp))
            Text("Remote mode (no reboot / shutdown, follows the Hub's view-only setting)", fontSize = 13.sp, color = Muted)
        }
        vm.error?.let { Text(it, color = Bad, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { vm.connect(url) }, enabled = !vm.connecting, modifier = Modifier.fillMaxWidth()) {
            if (vm.connecting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.Black)
            else Text("Connect")
        }
        Spacer(Modifier.height(12.dp))
        Text("Use the address of the FPP that has the plugin installed. Your phone must be on the same network (or have a VPN to it).", fontSize = 12.sp, color = Muted)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Dashboard(vm: HubViewModel) {
    val snack = remember { SnackbarHostState() }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var scanMenu by remember { mutableStateOf(false) }
    var sceneMenu by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf(false) }

    LaunchedEffect(vm.message) { vm.message?.let { snack.showSnackbar(it); vm.message = null } }

    Scaffold(
        containerColor = Bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = { Column { Text("Central Hub"); if (vm.version.isNotEmpty()) Text("plugin v" + vm.version, fontSize = 11.sp, color = Muted) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
                actions = {
                    if (!vm.readOnly) {
                        IconButton(onClick = { confirmOff = true }) { Icon(Icons.Filled.Lightbulb, "Lights off", tint = Accent) }
                        if (vm.scenes.isNotEmpty()) Box {
                            IconButton(onClick = { sceneMenu = true }) { Icon(Icons.Filled.PlayCircle, "Scenes") }
                            DropdownMenu(sceneMenu, { sceneMenu = false }) {
                                vm.scenes.forEach { s -> DropdownMenuItem(text = { Text(s.name) }, onClick = { sceneMenu = false; vm.runScene(s) }) }
                            }
                        }
                    }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Refresh") }, onClick = { menu = false; vm.reload() })
                        if (!vm.kioskMode) {
                            DropdownMenuItem(text = { Text("Scan for FPPs") }, onClick = { menu = false; vm.scan("fpp") })
                            DropdownMenuItem(text = { Text("Scan for controllers") }, onClick = { menu = false; vm.scan("controller") })
                            DropdownMenuItem(text = { Text("Scan for counters & sensors") }, onClick = { menu = false; vm.scan("sensor") })
                            DropdownMenuItem(text = { Text("Scan for smart plugs") }, onClick = { menu = false; vm.scan("plug") })
                        }
                        DropdownMenuItem(text = { Text("Event log") }, onClick = { menu = false; vm.loadEvents() })
                        DropdownMenuItem(text = { Text("Open Hub in browser") }, onClick = {
                            menu = false
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.hubUrl + "/plugin.php?plugin=fpp_Central_Hub&page=kiosk.php&nopage=1")))
                        })
                        DropdownMenuItem(text = { Text("Hub settings (browser)") }, onClick = {
                            menu = false
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(vm.hubUrl + "/plugin.php?plugin=fpp_Central_Hub&page=settings.php&nopage=1")))
                        })
                        DropdownMenuItem(text = { Text(if (vm.kioskMode) "Switch to full control" else "Switch to remote mode") }, onClick = { menu = false; vm.setKiosk(!vm.kioskMode) })
                        DropdownMenuItem(text = { Text("Change Hub address") }, onClick = { menu = false; vm.disconnect() })
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            vm.error?.let { Text("⚠ $it", color = Bad, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp)) }
            val groups = listOf("fpp" to "FPP players & remotes", "controller" to "Controllers", "sensor" to "Counters & sensors", "plug" to "Smart plugs")
            LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (vm.devices.isEmpty()) item {
                    Text("No devices yet. Use ⋮ → Scan to find your equipment.", color = Muted, modifier = Modifier.padding(16.dp))
                }
                for ((kind, title) in groups) {
                    val list = vm.devices.filter { it.kind == kind }
                    if (list.isEmpty()) continue
                    item { Text(title, color = Accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp, start = 4.dp)) }
                    items(list, key = { it.id }) { d -> DeviceCard(vm, d) }
                }
            }
        }
    }

    if (confirmOff) AlertDialog(
        onDismissRequest = { confirmOff = false },
        title = { Text("Lights off") },
        text = { Text("Send the all-lights-off command to every online FPP and WLED controller?") },
        confirmButton = { TextButton(onClick = { confirmOff = false; vm.lightsOffAll() }) { Text("Lights off") } },
        dismissButton = { TextButton(onClick = { confirmOff = false }) { Text("Cancel") } },
    )
    vm.events?.let { ev ->
        AlertDialog(
            onDismissRequest = { vm.events = null },
            title = { Text("Event log") },
            text = { LazyColumn { items(ev) { Text(it, fontSize = 12.sp, modifier = Modifier.padding(vertical = 2.dp)) } } },
            confirmButton = { TextButton(onClick = { vm.events = null }) { Text("Close") } },
        )
    }
}

@Composable
fun DeviceCard(vm: HubViewModel, d: Device) {
    val st = vm.statuses[d.id]
    val online = st?.online == true
    Card(colors = CardDefaults.cardColors(containerColor = Card), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(if (online) Good else if (st == null) Muted else Bad, androidx.compose.foundation.shape.CircleShape))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Text(d.ip + (if (d.type.isNotEmpty() && d.type != d.kind) "  ·  " + d.type else ""), fontSize = 11.sp, color = Muted)
                }
                if (d.id in vm.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else if (online) Text("${st?.ms ?: 0} ms", fontSize = 11.sp, color = Muted)
                else Text(if (st == null) "…" else "Offline", fontSize = 12.sp, color = Bad)
            }
            if (st != null && online) when (d.kind) {
                "fpp" -> FppBody(vm, d, st.detail)
                "plug" -> PlugBody(vm, d, st.detail)
                "sensor" -> SensorBody(vm, d, st.detail)
                else -> ControllerBody(vm, d, st.detail)
            }
            LinkedPower(vm, d)
        }
    }
}

@Composable
private fun Line(label: String, value: String) {
    if (value.isBlank()) return
    Row { Text(label, color = Muted, fontSize = 12.sp, modifier = Modifier.width(92.dp)); Text(value, fontSize = 13.sp) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FppBody(vm: HubViewModel, d: Device, j: JSONObject) {
    val fppd = j.optBoolean("fppd", true)
    val mode = j.optString("mode")
    val remote = mode.equals("remote", true)
    val state = j.optString("state")
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AssistChip(onClick = {}, label = { Text(if (remote) "Remote" else if (mode.isNotEmpty()) mode.replaceFirstChar { it.uppercase() } else "FPP") })
        if (state.isNotEmpty()) AssistChip(onClick = {}, label = { Text(state) })
    }
    Line("Playlist", j.optString("playlist"))
    Line("Sequence", j.optString("sequence"))
    val rem = if (j.isNull("remaining")) -1 else j.optInt("remaining", -1)
    if (rem >= 0 && j.optString("playlist").isNotEmpty()) Line("Remaining", fmtSecs(rem))
    Line("Next", listOf(j.optString("nextName"), j.optString("nextTime")).filter { it.isNotEmpty() }.joinToString(" at "))
    if (!j.isNull("temp")) Line("Temp", "%.0f°".format(j.optDouble("temp")))
    Line("Version", j.optString("version"))
    if (!fppd) { Text("FPPD is not running", color = Bad, fontSize = 13.sp); return }
    if (vm.readOnly) return

    // Remote-mode FPPs follow a player, so playlist controls are hidden for them.
    if (!remote) {
        LaunchedEffect(d.id) { vm.loadPlaylists(d) }
        val pls = vm.playlists[d.id] ?: emptyList()
        var sel by remember(pls) { mutableStateOf(pls.firstOrNull() ?: "") }
        var open by remember { mutableStateOf(false) }
        var repeat by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(open, { open = it }) {
            OutlinedTextField(
                value = sel, onValueChange = {}, readOnly = true, singleLine = true, label = { Text("Playlist") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(open, { open = false }) {
                pls.forEach { p -> DropdownMenuItem(text = { Text(p) }, onClick = { sel = p; open = false }) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(repeat, { repeat = it }); Text("Repeat", fontSize = 13.sp)
            Spacer(Modifier.weight(1f))
            Button(onClick = { if (sel.isNotEmpty()) vm.act(d, "start", JSONObject().put("playlist", sel).put("repeat", repeat)) }, enabled = sel.isNotEmpty()) {
                Icon(Icons.Filled.PlayArrow, null); Text("Start")
            }
            Spacer(Modifier.width(6.dp))
            OutlinedButton(onClick = { vm.act(d, "stopgraceful") }) { Text("Stop") }
            IconButton(onClick = { vm.act(d, "stop") }) { Icon(Icons.Filled.Stop, "Stop now", tint = Bad) }
        }
    }
    if (d.hasAudio) {
        var vol by remember(j.optInt("volume", 50)) { mutableStateOf(j.optInt("volume", 50).toFloat()) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.VolumeUp, null, tint = Muted)
            Slider(vol, { vol = it }, valueRange = 0f..100f, modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                onValueChangeFinished = { vm.act(d, "volume", JSONObject().put("value", vol.toInt()), refresh = false) })
            Text("${vol.toInt()}%", fontSize = 12.sp)
        }
    }
    FppExtras(vm, d)
}

@Composable
private fun FppExtras(vm: HubViewModel, d: Device) {
    var showTest by remember { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(onClick = { vm.act(d, "lights_off") }) { Text("Lights off") }
        OutlinedButton(onClick = { showTest = true }) { Text("Test") }
    }
    if (showTest) TestDialog(vm, d) { showTest = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TestDialog(vm: HubViewModel, d: Device, onClose: () -> Unit) {
    var models by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var model by remember { mutableStateOf<JSONObject?>(null) }
    var preset by remember { mutableStateOf("chase") }
    var mOpen by remember { mutableStateOf(false) }
    var active by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(d.id) {
        vm.actNow(d, "testmode_get", quiet = true)?.optJSONObject("data")?.let {
            active = it.optString("enabled") == "1" || it.optBoolean("enabled", false)
        }
        models = vm.actNow(d, "models", quiet = true)?.optJSONArray("data").objects()
    }
    fun send(enable: Boolean) {
        scope.launch {
            val a = JSONObject().put("enabled", enable).put("preset", preset)
            model?.let { a.put("channelSet", it.optInt("start").toString() + "-" + (it.optInt("start") + it.optInt("count") - 1)) }
            vm.actNow(d, "testmode_set", a)
            active = enable
        }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Test " + d.name) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ExposedDropdownMenuBox(mOpen, { mOpen = it }) {
                    OutlinedTextField(
                        value = model?.let { it.optString("name") + " (" + it.optInt("count") + " ch)" } ?: "All channels",
                        onValueChange = {}, readOnly = true, label = { Text("Model (picks the channels)") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(mOpen) }, modifier = Modifier.menuAnchor().fillMaxWidth())
                    ExposedDropdownMenu(mOpen, { mOpen = false }) {
                        DropdownMenuItem(text = { Text("All channels") }, onClick = { model = null; mOpen = false })
                        models.forEach { m -> DropdownMenuItem(text = { Text(m.optString("name")) }, onClick = { model = m; mOpen = false }) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(preset == "chase", { preset = "chase" }, label = { Text("RGB chase") })
                    FilterChip(preset == "cycle", { preset = "cycle" }, label = { Text("RGB cycle") })
                }
                Text(if (active) "Test pattern is running" else "Test mode is off", color = if (active) Accent else Muted, fontSize = 12.sp)
            }
        },
        confirmButton = { TextButton(onClick = { send(true) }) { Text("Start test") } },
        dismissButton = {
            Row {
                TextButton(onClick = { send(false) }) { Text("Stop test") }
                TextButton(onClick = onClose) { Text("Close") }
            }
        },
    )
}

@Composable
private fun PlugBody(vm: HubViewModel, d: Device, j: JSONObject) {
    val state = j.optString("state")
    val outlets = j.optJSONArray("outlets").objects()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(when (state) { "on" -> "ON"; "off" -> "OFF"; "mixed" -> "MIXED"; else -> "—" },
            color = if (state == "on") Good else Muted, fontWeight = FontWeight.Bold)
        if (!j.isNull("power")) Text("   %.1f W".format(j.optDouble("power")), color = Muted, fontSize = 12.sp)
    }
    if (vm.readOnly) return
    if (outlets.size > 1) outlets.forEach { o ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(o.optString("name"), Modifier.weight(1f))
            Switch(o.optBoolean("on"), { vm.act(d, "toggle", JSONObject().put("outlet", o.optString("id"))) })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Button(onClick = { vm.act(d, "on", JSONObject().put("outlet", "*")) }) { Text(if (outlets.size > 1) "All on" else "On") }
        OutlinedButton(onClick = { vm.act(d, "off", JSONObject().put("outlet", "*")) }) { Text(if (outlets.size > 1) "All off" else "Off") }
    }
}

@Composable
private fun SensorBody(vm: HubViewModel, d: Device, j: JSONObject) {
    // Show the headline numbers the Hub reports for the Lidar counter / BaldrickSignals board.
    var shown = 0
    for (k in j.keys()) {
        if (shown >= 8) break
        val v = j.opt(k)
        if (v is String || v is Number || v is Boolean) {
            if (v.toString().isBlank() || k == "http") continue
            Line(k.replaceFirstChar { it.uppercase() }, v.toString()); shown++
        }
    }
    if (d.type == "lidar" && !vm.readOnly) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(onClick = { vm.act(d, "adjust", JSONObject().put("delta", -1)) }) { Icon(Icons.Filled.Remove, "-1") }
        OutlinedButton(onClick = { vm.act(d, "adjust", JSONObject().put("delta", 1)) }) { Icon(Icons.Filled.Add, "+1") }
    }
}

@Composable
private fun ControllerBody(vm: HubViewModel, d: Device, j: JSONObject) {
    Line("Page", j.optString("title"))
    if (d.type == "wled") {
        if (!j.isNull("leds")) Line("LEDs", j.optString("leds"))
        if (!j.isNull("rssi")) Line("Wi-Fi", j.optString("rssi") + " dBm")
        if (!vm.readOnly) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = { vm.act(d, "toggle") }) { Text("Toggle") }
            OutlinedButton(onClick = { vm.act(d, "lights_off") }) { Text("Lights off") }
        }
    }
}

/** "Turn on / Turn off" for the smart plug that powers this device, so you don't have to find the plug card. */
@Composable
private fun LinkedPower(vm: HubViewModel, d: Device) {
    val lp = d.raw.optJSONObject("linkedPlug") ?: return
    val plug = vm.devices.firstOrNull { it.id == lp.optString("id") } ?: return
    if (vm.readOnly) return
    val outlet = lp.optString("outlet", "*").ifEmpty { "*" }
    val args = { JSONObject().put("outlet", outlet) }
    val outlets = vm.statuses[plug.id]?.detail?.optJSONArray("outlets").objects()
        .filter { outlet == "*" || it.optString("id") == outlet }
    val on: Boolean? = if (outlets.isEmpty()) null else outlets.any { it.optBoolean("on") }
    var confirmOff by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Powered by " + plug.name + (if (on == null) "" else if (on) " (on)" else " (off)"), color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
        if (on != true) Button(onClick = { vm.act(plug, "on", args()) }) { Text("Turn on") }
        if (on != false) OutlinedButton(onClick = { confirmOff = true }) { Text("Turn off") }
    }
    if (confirmOff) AlertDialog(
        onDismissRequest = { confirmOff = false },
        title = { Text("Cut power?") },
        text = { Text("Turn off ${plug.name}? ${d.name} will lose power and its show will stop.") },
        confirmButton = { TextButton(onClick = { confirmOff = false; vm.act(plug, "off", args()) }) { Text("Turn off") } },
        dismissButton = { TextButton(onClick = { confirmOff = false }) { Text("Cancel") } },
    )
}
