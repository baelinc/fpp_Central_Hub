package com.baelinc.fppcentralhub

import org.json.JSONArray
import org.json.JSONObject

data class Device(val id: String, val kind: String, val type: String, val name: String, val ip: String,
                  val port: Int, val hidden: Boolean, val hasAudio: Boolean, val raw: JSONObject)

data class Status(val online: Boolean, val ms: Int, val detail: JSONObject)

data class Step(val device: String, val cmd: String, val args: JSONObject, val delay: Int)
data class Scene(val id: String, val name: String, val steps: List<Step>)

fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    val out = ArrayList<JSONObject>()
    for (i in 0 until length()) optJSONObject(i)?.let { out.add(it) }
    return out
}

fun parseDevice(o: JSONObject): Device {
    val extra = o.optJSONObject("extra")
    return Device(
        id = o.optString("id"), kind = o.optString("kind"), type = o.optString("type"),
        name = o.optString("name").ifEmpty { o.optString("ip") }, ip = o.optString("ip"),
        port = o.optInt("port", 80), hidden = o.optBoolean("hidden", false),
        hasAudio = o.optBoolean("hasAudio", false) || (extra?.optBoolean("hasAudio", false) ?: false), raw = o,
    )
}

fun parseScene(o: JSONObject): Scene = Scene(
    o.optString("id"), o.optString("name"),
    o.optJSONArray("steps").objects().map {
        Step(it.optString("device"), it.optString("cmd"), it.optJSONObject("args") ?: JSONObject(), it.optInt("delay", 0))
    },
)

fun parseStatus(o: JSONObject): Status =
    Status(o.optBoolean("online", false), o.optInt("ms", 0), o.optJSONObject("detail") ?: JSONObject())

fun fmtSecs(s: Int): String = "%d:%02d".format(s / 60, s % 60)
