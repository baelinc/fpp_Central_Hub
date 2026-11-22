package com.baelinc.fppcentralhub

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class HubException(message: String) : Exception(message)

/** Talks to the FPP Central Hub plugin's hub_api.php. Call from a background thread. */
class HubApi(rawBase: String, private val kiosk: Boolean) {
    val base: String = normalize(rawBase)

    fun call(action: String, body: JSONObject? = null, query: String = ""): JSONObject {
        val url = base + "/plugin.php?plugin=fpp_Central_Hub&page=hub_api.php&nopage=1&action=" +
            URLEncoder.encode(action, "UTF-8") + (if (query.isNotEmpty()) "&$query" else "")
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 6000
            c.readTimeout = 60000 // a network scan can take a while
            c.setRequestProperty("X-Requested-With", "hub")
            if (kiosk) c.setRequestProperty("X-Hub-Mode", "kiosk")
            c.setRequestProperty("Accept", "application/json")
            if (body != null) {
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else (c.errorStream ?: c.inputStream)
            val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val j = try { JSONObject(text) } catch (e: Exception) {
                throw HubException("Unexpected reply from the Hub (HTTP $code). Is the address right and the plugin installed?")
            }
            if (code !in 200..299 || j.optBoolean("ok", true) == false) {
                throw HubException(j.optString("error", j.optString("msg", "Request failed (HTTP $code)")))
            }
            return j
        } catch (e: HubException) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            throw HubException("The Hub did not answer in time")
        } catch (e: java.io.IOException) {
            throw HubException("Cannot reach the Hub at $base")
        } finally {
            c.disconnect()
        }
    }

    fun act(id: String, cmd: String, args: JSONObject = JSONObject()): JSONObject =
        call("act", JSONObject().put("id", id).put("cmd", cmd).put("args", args))

    companion object {
        fun normalize(s: String): String {
            var t = s.trim().trimEnd('/')
            if (t.isEmpty()) return t
            if (!t.startsWith("http://") && !t.startsWith("https://")) t = "http://$t"
            return t
        }
    }
}
