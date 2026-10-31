package expo.modules.uikatranslate

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Terjemahan Indonesia ⇄ Inggris di perangkat memakai Google ML Kit.
 * Penerjemah per pasangan bahasa disimpan agar tidak dibuat ulang setiap kalimat.
 */
class UikaTranslateModule : Module() {
  private val translators = HashMap<String, Translator>()
  private val ready: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())

  private fun lang(code: String): String =
    TranslateLanguage.fromLanguageTag(code) ?: throw CodedException("ERR_LANG", "Bahasa tidak didukung: $code", null)

  private fun translatorFor(from: String, to: String): Translator {
    val key = "$from>$to"
    return synchronized(translators) {
      translators.getOrPut(key) {
        Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(lang(from)).setTargetLanguage(lang(to)).build())
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("UikaTranslate")

    // Unduh model bahasa bila belum ada. wifiOnly = hanya lewat Wi-Fi.
    AsyncFunction("prepare") { from: String, to: String, wifiOnly: Boolean, promise: Promise ->
      val key = "$from>$to"
      if (ready.contains(key)) {
        promise.resolve(true)
      } else {
        val t = translatorFor(from, to)
        val builder = DownloadConditions.Builder()
        if (wifiOnly) builder.requireWifi()
        t.downloadModelIfNeeded(builder.build())
          .addOnSuccessListener { ready.add(key); promise.resolve(true) }
          .addOnFailureListener { e -> promise.reject(CodedException("ERR_DOWNLOAD", e.message ?: "Gagal mengunduh model bahasa", e)) }
      }
      Unit
    }

    AsyncFunction("isReady") { from: String, to: String ->
      ready.contains("$from>$to")
    }

    AsyncFunction("translate") { text: String, from: String, to: String, promise: Promise ->
      val key = "$from>$to"
      val t = translatorFor(from, to)
      val run: () -> Unit = {
        t.translate(text)
          .addOnSuccessListener { out -> promise.resolve(out) }
          .addOnFailureListener { e -> promise.reject(CodedException("ERR_TRANSLATE", e.message ?: "Gagal menerjemahkan", e)) }
      }
      if (ready.contains(key)) {
        run()
      } else {
        t.downloadModelIfNeeded(DownloadConditions.Builder().build())
          .addOnSuccessListener { ready.add(key); run() }
          .addOnFailureListener { e -> promise.reject(CodedException("ERR_DOWNLOAD", e.message ?: "Model bahasa belum tersedia", e)) }
      }
      Unit
    }

    OnDestroy {
      synchronized(translators) { translators.values.forEach { it.close() }; translators.clear() }
    }
  }
}
