package com.beatpotato.android

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.DialogInterface
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Random
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 暴打土豆 —— Android MVP（Phase 6）
 *
 * 核心玩法与 PC 端保持一致：
 *   · 点击土豆 → 打击动画 + 音效 + 计数 +1
 *   · 连击（6 秒内连续点击）驱动六状态，每升级一次换一张表情
 *   · 连击徽章 + 今日暴打徽章跟随土豆
 *   · 右键水枪 / 中键中指在手机端是两个按钮，不计数、不影响状态
 *   · 水枪打满 5 下 → 滋湿状态（4 秒后自干）；期间弹「土豆本豆」展开图
 *
 * 性能铁律（沿用 PC 端）：待机时没有任何定时器、轮询或持续渲染。
 * 所有动画都由点击触发，跑完即停。
 */
class MainActivity : Activity() {

    // ── 视图 ────────────────────────────────────────────────────────────
    private lateinit var root: FrameLayout
    private lateinit var potatoView: ImageView
    private lateinit var streakBadge: StreakBadgeView
    private lateinit var todayBadge: TodayBadgeView
    private lateinit var volumeButton: VolumeButtonView
    private lateinit var totalView: TextView
    private lateinit var squirtProp: ImageView
    private lateinit var fingerProp: ImageView
    private lateinit var propBar: LinearLayout
    private lateinit var flashImage: ImageView

    // ── 素材 ────────────────────────────────────────────────────────────
    private lateinit var idleFrame: Bitmap
    private lateinit var hitFrames: List<Bitmap>
    private var stateFrames: List<Bitmap?> = emptyList()
    private var stateHitFrames: List<Bitmap?> = emptyList()
    private var wetFrame: Bitmap? = null
    private var squirtSprite: Bitmap? = null
    private var fingerSprite: Bitmap? = null
    private var squirtIcon: Bitmap? = null
    private var fingerIcon: Bitmap? = null
    private var flashSprite: Bitmap? = null
    private val streakDigits = arrayOfNulls<Bitmap>(10)
    private val todayDigits = arrayOfNulls<Bitmap>(10)
    private val bursts = ArrayList<Bitmap>(4)
    private var labelJin: Bitmap? = null
    private var labelBao: Bitmap? = null

    // ── 状态 ────────────────────────────────────────────────────────────
    private var stateThresholds = IntArray(0)
    private var stateIndex = 0
    private val rng = Random()

    // ── 音效 ────────────────────────────────────────────────────────────
    private lateinit var soundPool: SoundPool
    private var hitSoundId = 0
    private var squirtSoundIds = IntArray(0)
    private var despiseSoundId = 0
    private var lineWetId = 0
    private var lineStage2Id = 0
    private var lineFinalId = 0
    private var lineRandomIds = IntArray(0)

    // ── 计数 ────────────────────────────────────────────────────────────
    private var totalHits = 0
    private var todayHits = 0
    private var todayDate = ""
    private var streakHits = 0
    private var volumePercent = DEFAULT_VOLUME_PERCENT

    // ── 台词调度 ────────────────────────────────────────────────────────
    private var lineEndsAtMs = 0L
    private var lineDurationMs = 0
    private var clicksSinceRandomLineHit = RANDOM_LINE_COOLDOWN_CLICKS_HIT
    private var clicksSinceRandomLineProp = RANDOM_LINE_COOLDOWN_CLICKS_PROP
    private var clickSeq = 0
    private var randomLineBlockedUntil = 0

    // ── 道具 ────────────────────────────────────────────────────────────
    private var squirtCount = 0
    private var squirtTotal = 0
    private var wet = false

    // ── 动画 ────────────────────────────────────────────────────────────
    private val animHandler = Handler(Looper.getMainLooper())
    private val flashHandler = Handler(Looper.getMainLooper())
    private var popFrame = 0

    /** 受击帧保持一段时间后回弹到当前状态的静息帧。 */
    private val animStep = Runnable { potatoView.setImageBitmap(currentStateFrame()) }

    /** 水枪 / 中指道具各自到点自动隐藏。 */
    private val hideSquirtProp = Runnable { squirtProp.visibility = View.INVISIBLE }
    private val hideFingerProp = Runnable { fingerProp.visibility = View.INVISIBLE }
    private val dryUp = Runnable { exitWet() }

    /** 「土豆本豆」展开图三段：放大 → 保持 → 淡出。 */
    private val flashGrow = Runnable {
        val anim = ValueAnimator.ofFloat(FLASH_SCALE_FROM, 1f)
        anim.duration = FLASH_GROW_MS.toLong()
        anim.interpolator = DecelerateInterpolator()
        anim.addUpdateListener { a ->
            val s = a.animatedValue as Float
            flashImage.scaleX = s
            flashImage.scaleY = s
        }
        anim.start()
    }
    private val flashHold = Runnable { /* 保持阶段无需动作 */ }
    private val flashFade = Runnable {
        val anim = ValueAnimator.ofFloat(1f, 0f)
        anim.duration = FLASH_FADE_MS.toLong()
        anim.addUpdateListener { a -> flashImage.alpha = a.animatedValue as Float }
        anim.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                flashImage.visibility = View.INVISIBLE
                flashImage.alpha = 1f
            }
        })
        anim.start()
    }

    /** 连击 6 秒超时：清空连击、隐藏徽章、重掷阈值、回到正常。 */
    private val streakReset = Runnable {
        streakHits = 0
        streakBadge.visibility = View.GONE
        rerollStateThresholds()
        applyStateVisual()
    }

    /** 徽章弹跳：1.45 → 1.2 → 1.1 → 1.0。 */
    private val badgePop = object : Runnable {
        override fun run() {
            val s = when (popFrame++) {
                0 -> 1.2f
                1 -> 1.1f
                else -> 1f
            }
            streakBadge.scaleX = s
            streakBadge.scaleY = s
            if (popFrame < 3) animHandler.postDelayed(this, FRAME_MS)
        }
    }

    // ── 生命周期 ────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        loadStats()
        loadVolume()

        idleFrame = decodeFrame("idle.png")
        hitFrames = listOf(decodeFrame("hit_1.png"), decodeFrame("hit_2.png"), decodeFrame("hit_3.png"))
        loadStateFrames()
        ensureStateThresholds()
        stateIndex = computeStateIndex()

        // SoundPool：USAGE_MEDIA + CONTENT_TYPE_MUSIC，走媒体音量控制
        soundPool = SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .build()
        hitSoundId = soundPool.load(assets.openFd("audio/hit.wav"), 1)
        squirtSoundIds = IntArray(4) { soundPool.load(assets.openFd("audio/squirt_${it + 1}.wav"), 1) }
        despiseSoundId = soundPool.load(assets.openFd("audio/despise.wav"), 1)
        lineWetId = soundPool.load(assets.openFd("audio/line_wet.wav"), 1)
        lineStage2Id = soundPool.load(assets.openFd("audio/line_stage2.wav"), 1)
        lineFinalId = soundPool.load(assets.openFd("audio/line_final.wav"), 1)
        lineRandomIds = IntArray(5) { soundPool.load(assets.openFd("audio/line_rand${it + 1}.wav"), 1) }

        val d = resources.displayMetrics.density
        val side = (POTATO_DP * d).toInt()

        potatoView = ImageView(this).apply {
            setImageBitmap(currentStateFrame())
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        volumeButton = VolumeButtonView(this)
        decodeCounterAssets()
        decodePropAssets()
        streakBadge = StreakBadgeView(this)
        todayBadge = TodayBadgeView(this)

        root = FrameLayout(this).apply { setBackgroundColor(BG_COLOR) }

        root.addView(
            potatoView,
            FrameLayout.LayoutParams(side, side, android.view.Gravity.CENTER)
        )
        root.addView(
            streakBadge,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.TOP or android.view.Gravity.START
            )
        )
        root.addView(
            todayBadge,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.TOP or android.view.Gravity.START
            )
        )

        val sbRes = resources.getIdentifier("status_bar_height", "dimen", "android")
        val statusBar = if (sbRes != 0) resources.getDimensionPixelSize(sbRes) else 0

        totalView = TextView(this).apply {
            textSize = 14f
            setTextColor(INK_COLOR)
            text = "总暴打 $totalHits"
        }
        root.addView(
            totalView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.TOP or android.view.Gravity.START
            ).apply {
                topMargin = statusBar + (8 * d).toInt()
                marginStart = (12 * d).toInt()
            }
        )

        root.addView(
            volumeButton,
            FrameLayout.LayoutParams((48 * d).toInt(), (48 * d).toInt(), android.view.Gravity.TOP or android.view.Gravity.END).apply {
                topMargin = statusBar + (4 * d).toInt()
                marginEnd = (12 * d).toInt()
            }
        )

        // 道具层：水枪 / 中指覆盖在土豆上，位置由 applyPropLayout() 算
        squirtProp = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_XY
            visibility = View.INVISIBLE
            isClickable = false
            isFocusable = false
        }
        fingerProp = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_XY
            visibility = View.INVISIBLE
            isClickable = false
            isFocusable = false
        }
        root.addView(squirtProp, FrameLayout.LayoutParams(0, 0))
        root.addView(fingerProp, FrameLayout.LayoutParams(0, 0))

        // 底部道具按钮条
        propBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER
        }
        propBar.addView(
            PropButtonView(this, PROP_SQUIRT),
            LinearLayout.LayoutParams((d * PROP_BUTTON_DP).toInt(), (d * PROP_BUTTON_DP).toInt())
        )
        propBar.addView(
            PropButtonView(this, PROP_FINGER),
            LinearLayout.LayoutParams((d * PROP_BUTTON_DP).toInt(), (d * PROP_BUTTON_DP).toInt()).apply {
                marginStart = (d * PROP_BUTTON_GAP_DP).toInt()
            }
        )
        root.addView(
            propBar,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
            ).apply {
                bottomMargin = (d * PROP_BAR_BOTTOM_DP).toInt()
            }
        )

        setContentView(root)

        // 展开图层最后加，保证在最上面（同 PC 端 FlashLayer）
        flashImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_XY
            visibility = View.INVISIBLE
            isClickable = false
            isFocusable = false
        }
        root.addView(flashImage, FrameLayout.LayoutParams(0, 0))

        root.post { applyPropLayout() }
    }

    override fun onPause() {
        saveStats()
        super.onPause()
    }

    override fun onDestroy() {
        animHandler.removeCallbacks(animStep)
        animHandler.removeCallbacks(streakReset)
        animHandler.removeCallbacks(hideSquirtProp)
        animHandler.removeCallbacks(hideFingerProp)
        animHandler.removeCallbacks(dryUp)
        flashHandler.removeCallbacks(flashGrow)
        flashHandler.removeCallbacks(flashHold)
        flashHandler.removeCallbacks(flashFade)
        soundPool.release()
        super.onDestroy()
    }

    // ── 素材解码 ────────────────────────────────────────────────────────

    private val rawDecodeOptions: BitmapFactory.Options
        get() = BitmapFactory.Options().apply { inScaled = false }

    private fun decodeFrame(name: String): Bitmap =
        BitmapFactory.decodeStream(assets.open("potato/$name"), null, rawDecodeOptions)
            ?: throw IllegalStateException("素材无法解码：potato/$name")

    private fun decodeFrameOrNull(name: String): Bitmap? = try {
        BitmapFactory.decodeStream(assets.open("potato/$name"), null, rawDecodeOptions)
    } catch (e: Exception) {
        null
    }

    private fun loadStateFrames() {
        stateFrames = (0 until STATE_COUNT).map { i ->
            if (i == 0) null else decodeFrameOrNull("state/state_$i.png")
        }
        stateHitFrames = (0 until STATE_COUNT).map { i -> decodeFrameOrNull("state/state_${i}_hit.png") }
    }

    private fun decodePropAssets() {
        wetFrame = decodeFrameOrNull("state/wet.png")
        squirtSprite = decodeFrameOrNull("水枪.png")
        fingerSprite = decodeFrameOrNull("中指.png")
        squirtIcon = decodeFrameOrNull("ui/btn_squirt.png")
        fingerIcon = decodeFrameOrNull("ui/btn_finger.png")
        flashSprite = decodeFrameOrNull("土豆本豆.jpg")
    }

    private fun decodeCounterAssets() {
        try {
            for (i in 0..9) streakDigits[i] = decodeScaled("potato/counter/total_$i.png", STREAK_DIGIT_DP)
        } catch (e: Exception) {
            streakDigits.fill(null)
            todayDigits.fill(null)
            bursts.clear()
            labelJin = null
            labelBao = null
            return
        }
        for (i in 0..9) todayDigits[i] = decodeScaled("potato/counter/today_$i.png", TODAY_DIGIT_DP)
        for (i in 1..4) decodeScaled("potato/counter/burst_$i.png", STREAK_DIGIT_DP * BURST_HEIGHT_RATIO)?.let { bursts.add(it) }
        labelJin = decodeScaled("potato/counter/label_jin.png", TODAY_DIGIT_DP)
        labelBao = decodeScaled("potato/counter/label_bao.png", TODAY_DIGIT_DP)
    }

    private fun decodeScaled(path: String, heightDp: Float): Bitmap? {
        val src = BitmapFactory.decodeStream(assets.open(path), null, rawDecodeOptions) ?: return null
        val h = (resources.displayMetrics.density * heightDp).roundToInt()
        if (src.height == h) return src
        val w = (src.width * h) / src.height
        return Bitmap.createScaledBitmap(src, w, h, true)
    }

    // ── 六状态 ──────────────────────────────────────────────────────────

    private fun computeStateIndex(): Int {
        var state = 0
        for (i in stateThresholds.indices) {
            if (streakHits >= stateThresholds[i]) state = i + 1
        }
        return state
    }

    /** 湿身优先：湿着的时候不管连击到哪一档，都显示湿身图。 */
    fun currentStateFrame(): Bitmap {
        if (wet) wetFrame?.let { return it }
        if (stateIndex <= 0) return idleFrame
        return stateFrames.getOrNull(stateIndex) ?: idleFrame
    }

    /** 湿身期间没有专门的受击帧，直接用湿身图，避免连点时两种画风互闪。 */
    private fun currentHitFrame(): Bitmap {
        if (wet) wetFrame?.let { return it }
        return stateHitFrames.getOrNull(stateIndex) ?: hitFrames[0]
    }

    private fun applyStateVisual(): Boolean {
        val state = computeStateIndex()
        val changed = state != stateIndex
        stateIndex = state
        if (changed) {
            potatoView.setImageBitmap(currentStateFrame())
            applyPropLayout()   // 各状态素材宽高比不同 → 土豆显示框变 → 道具跟着重摆
        }
        return changed
    }

    private fun ensureStateThresholds() {
        if (isValidThresholds(stateThresholds)) return
        rerollStateThresholds()
    }

    private fun rerollStateThresholds() {
        val t = IntArray(STATE_THRESHOLD_RANGES.size)
        for (i in t.indices) {
            val lo = STATE_THRESHOLD_RANGES[i][0]
            val hi = STATE_THRESHOLD_RANGES[i][1]
            t[i] = rng.nextInt(hi - lo + 1) + lo
            if (i > 0 && t[i] <= t[i - 1]) t[i] = t[i - 1] + 1
        }
        stateThresholds = t
        saveStats()
    }

    private fun isValidThresholds(t: IntArray): Boolean {
        if (t.size != STATE_THRESHOLD_RANGES.size) return false
        for (i in t.indices) {
            if (t[i] < STATE_THRESHOLD_RANGES[i][0] || t[i] > STATE_THRESHOLD_RANGES[i][1]) return false
            if (i > 0 && t[i] <= t[i - 1]) return false
        }
        return true
    }

    // ── 道具布局 ────────────────────────────────────────────────────────

    /**
     * 把水枪 / 中指摆到土豆上。
     *
     * PC 端是靠把窗口加宽来给道具留位置；手机屏宽固定，所以水枪算完 PC 比例后
     * 还要按「右侧还剩多少地方」再收窄一次，保证整把枪在屏内。
     */
    fun applyPropLayout() {
        if (!::root.isInitialized || !::squirtProp.isInitialized) return
        val rootW = root.width
        val rootH = root.height
        if (rootW <= 0 || rootH <= 0) return

        val d = resources.displayMetrics.density
        val boxSide = POTATO_DP * d

        // 反算土豆实际显示框（FIT_CENTER 等比缩放后的尺寸）
        val sprite = currentStateFrame()
        val maxDim = max(sprite.width, sprite.height).toFloat()
        val dispW = sprite.width * boxSide / maxDim
        val dispH = sprite.height * boxSide / maxDim
        val potatoLeft = rootW / 2f - dispW / 2f
        val potatoTop = rootH / 2f - dispH / 2f
        val potatoRight = potatoLeft + dispW

        // ── 水枪：枪口朝左，枪口对齐土豆右缘并略微叠进去 ──
        squirtSprite?.let { bmp ->
            val muzzleX = potatoRight - dispH * SQUIRT_OVERLAP_RATIO
            val availContentW = rootW - PROP_EDGE_MARGIN_DP * d - muzzleX
            val contentH = min(dispH * SQUIRT_CONTENT_HEIGHT_RATIO, availContentW / SQUIRT_CONTENT_ASPECT)
            val imgH = contentH / SQUIRT_CONTENT_H_RATIO
            val imgW = imgH * bmp.width / bmp.height
            squirtProp.setImageBitmap(bmp)
            squirtProp.layoutParams = FrameLayout.LayoutParams(imgW.roundToInt(), imgH.roundToInt())
            squirtProp.x = muzzleX - imgW * SQUIRT_CONTENT_X_RATIO
            squirtProp.y = potatoTop + dispH * SQUIRT_CENTER_Y_RATIO - imgH * SQUIRT_CONTENT_Y_RATIO
        }

        // ── 中指：居中、略偏下，手腕露出土豆底边 ──
        fingerSprite?.let { bmp ->
            val contentH = dispH * FINGER_CONTENT_HEIGHT_RATIO
            val imgH = contentH / FINGER_CONTENT_H_RATIO
            val imgW = imgH * bmp.width / bmp.height
            fingerProp.setImageBitmap(bmp)
            fingerProp.layoutParams = FrameLayout.LayoutParams(imgW.roundToInt(), imgH.roundToInt())
            fingerProp.x = rootW / 2f - imgW * FINGER_CONTENT_CENTER_X_RATIO
            fingerProp.y = potatoTop + dispH * FINGER_CONTENT_Y_RATIO - imgH * FINGER_CONTENT_CENTER_Y_RATIO
        }
    }

    // ── 交互 ────────────────────────────────────────────────────────────

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) onHit()
        return true
    }

    /** 左键（点土豆）：唯一会累加计数和推进状态的入口。 */
    private fun onHit() {
        rollTodayIfNeeded()
        onClickTick()
        totalHits++
        todayHits++
        streakHits++
        totalView.text = "总暴打 $totalHits"

        val prevState = stateIndex
        val playedLine = playStateLine(prevState, computeStateIndex()) || playRandomLineIfLucky(leftClick = true)
        if (!playedLine && !lineIsPlaying()) {
            val v = volumeScalar()
            soundPool.play(hitSoundId, v, v, 1, 0, 1f)
        }

        applyStateVisual()

        animHandler.removeCallbacks(animStep)
        potatoView.setImageBitmap(currentHitFrame())
        animHandler.postDelayed(animStep, HOLD_MS)

        streakBadge.update()
        todayBadge.update()
        animHandler.removeCallbacks(streakReset)
        animHandler.postDelayed(streakReset, STREAK_RESET_MS)

        popFrame = 0
        streakBadge.scaleX = BADGE_POP_PEAK
        streakBadge.scaleY = BADGE_POP_PEAK
        animHandler.removeCallbacks(badgePop)
        animHandler.postDelayed(badgePop, FRAME_MS)
    }

    /**
     * 水枪（右键）：不计数、不影响状态。
     * 打满 5 下进入滋湿；湿着时再喷只续命，不重复计数。
     */
    fun squirt() {
        onClickTick()
        squirtTotal++

        // 前 SQUIRT_LINE_BLOCK_CLICKS 下不参与随机台词，先把水声铺垫出来
        if (!wet && squirtCount + 1 < SQUIRT_HITS_TO_WET) {
            if (!lineIsPlaying() && squirtTotal > SQUIRT_LINE_BLOCK_CLICKS) {
                if (!playRandomLineIfLucky(leftClick = false)) playSquirtSound()
            } else if (!lineIsPlaying()) {
                playSquirtSound()
            }
        }

        squirtProp.visibility = View.VISIBLE
        animHandler.removeCallbacks(hideSquirtProp)
        animHandler.postDelayed(hideSquirtProp, SQUIRT_PROP_HOLD_MS)

        if (wet) {
            animHandler.removeCallbacks(dryUp)
            animHandler.postDelayed(dryUp, WET_HOLD_MS)
            return
        }
        if (++squirtCount >= SQUIRT_HITS_TO_WET) {
            squirtCount = 0
            enterWet()
        }
    }

    private fun playSquirtSound() {
        if (squirtSoundIds.isEmpty()) return
        val v = volumeScalar()
        soundPool.play(squirtSoundIds[rng.nextInt(squirtSoundIds.size)], v, v, 1, 0, 1f)
    }

    /** 中指（中键）：不计数、不影响状态。 */
    fun showFinger() {
        onClickTick()
        if (!lineIsPlaying() && !playRandomLineIfLucky(leftClick = false)) {
            val v = volumeScalar()
            soundPool.play(despiseSoundId, v, v, 1, 0, 1f)
        }
        fingerProp.visibility = View.VISIBLE
        animHandler.removeCallbacks(hideFingerProp)
        animHandler.postDelayed(hideFingerProp, FINGER_PROP_HOLD_MS)
    }

    private fun enterWet() {
        wet = true
        potatoView.setImageBitmap(currentStateFrame())
        applyPropLayout()
        playNodeLine(lineWetId, LINE_WET_MS)
        showFlash()
        animHandler.removeCallbacks(dryUp)
        animHandler.postDelayed(dryUp, WET_HOLD_MS)
    }

    fun exitWet() {
        animHandler.removeCallbacks(dryUp)
        if (!wet) return
        wet = false
        potatoView.setImageBitmap(currentStateFrame())
        applyPropLayout()
    }

    // ── 台词系统 ────────────────────────────────────────────────────────

    private fun lineIsPlaying(): Boolean =
        lineDurationMs > 0 && SystemClock.uptimeMillis() < lineEndsAtMs

    /** 左键 / 水枪 / 中指三个入口共用，用于台词冷却与节点屏蔽窗口计数。 */
    private fun onClickTick() {
        clickSeq++
        clicksSinceRandomLineHit++
        clicksSinceRandomLineProp++
    }

    private fun playLine(soundId: Int, durationMs: Int) {
        if (soundId == 0) return
        val v = volumeScalar()
        soundPool.play(soundId, v, v, 1, 0, 1f)
        lineDurationMs = if (durationMs > 0) durationMs else DEFAULT_LINE_MS
        lineEndsAtMs = SystemClock.uptimeMillis() + lineDurationMs
    }

    /** 升级节点台词：播完后再屏蔽 NODE_LINE_BLOCK_CLICKS 次点击的随机台词。 */
    private fun playNodeLine(soundId: Int, durationMs: Int) {
        playLine(soundId, durationMs)
        randomLineBlockedUntil = clickSeq + NODE_LINE_BLOCK_CLICKS
    }

    private fun playStateLine(prevState: Int, nextState: Int): Boolean {
        if (nextState == prevState) return false
        if (nextState == 1) {
            playNodeLine(lineStage2Id, LINE_STAGE2_MS)
            return true
        }
        if (nextState < 5) return false
        playNodeLine(lineFinalId, LINE_FINAL_MS)
        return true
    }

    /**
     * 随机台词。
     *
     * 两道闸都只对左键生效 —— 中指和水枪是「玩具」，不受第一阶段和节点屏蔽的限制，
     * 这样道具的手感不会因为状态机进度而变得沉闷。
     */
    private fun playRandomLineIfLucky(leftClick: Boolean = false): Boolean {
        if (lineRandomIds.isEmpty() || clickSeq <= randomLineBlockedUntil) return false
        if (leftClick && stateIndex <= 0) return false        // 左键还没进第一阶段
        if (leftClick && nearUpgradeNode()) return false      // 左键处在升级节点前
        if (leftClick) {
            if (clicksSinceRandomLineHit < RANDOM_LINE_COOLDOWN_CLICKS_HIT) return false
        } else {
            if (clicksSinceRandomLineProp < RANDOM_LINE_COOLDOWN_CLICKS_PROP) return false
        }
        if (rng.nextInt(100) >= RANDOM_LINE_PERCENT) return false

        val i = rng.nextInt(lineRandomIds.size)
        playLine(lineRandomIds[i], LINE_RANDOM_MS[i])
        if (leftClick) clicksSinceRandomLineHit = 0 else clicksSinceRandomLineProp = 0
        return true
    }

    private fun nearUpgradeNode(): Boolean {
        if (stateThresholds.size < 5) return false
        return nearThreshold(stateThresholds[0]) || nearThreshold(stateThresholds[4])
    }

    private fun nearThreshold(threshold: Int): Boolean {
        val remain = threshold - streakHits
        return remain in 0..NODE_LINE_BLOCK_CLICKS
    }

    // ── 展开图 ──────────────────────────────────────────────────────────

    /** 「土豆本豆」整张从屏幕中间放大甩出，保持一下再淡出。 */
    private fun showFlash() {
        val bmp = flashSprite ?: return
        val rootW = root.width
        val rootH = root.height
        if (rootW <= 0 || rootH <= 0) return

        val d = resources.displayMetrics.density
        val boxSide = POTATO_DP * d
        val sprite = currentStateFrame()
        val maxDim = max(sprite.width, sprite.height).toFloat()
        val dispH = sprite.height * boxSide / maxDim

        val h = FLASH_HEIGHT_RATIO * dispH
        val w = bmp.width * h / bmp.height
        val x = (rootW - w) * FLASH_LEFT_RATIO
        val y = (rootH - h) / 2f

        flashImage.setImageBitmap(bmp)
        flashImage.layoutParams = FrameLayout.LayoutParams(w.roundToInt(), h.roundToInt())
        flashImage.pivotX = w / 2f
        flashImage.pivotY = h / 2f
        flashImage.x = x
        flashImage.y = y
        flashImage.scaleX = FLASH_SCALE_FROM
        flashImage.scaleY = FLASH_SCALE_FROM
        flashImage.alpha = 1f
        flashImage.visibility = View.VISIBLE

        flashHandler.removeCallbacks(flashGrow)
        flashHandler.removeCallbacks(flashHold)
        flashHandler.removeCallbacks(flashFade)
        flashHandler.postDelayed(flashGrow, 1L)
        flashHandler.postDelayed(flashHold, (FLASH_GROW_MS + FLASH_HOLD_MS).toLong())
        flashHandler.postDelayed(flashFade, (FLASH_GROW_MS + FLASH_HOLD_MS + FLASH_FADE_MS).toLong())
    }

    // ── 音量 ────────────────────────────────────────────────────────────

    private fun volumeScalar(): Float = volumePercent * (VOLUME_75_SCALE / 75f)

    private fun loadVolume() {
        volumePercent = getSharedPreferences("settings", MODE_PRIVATE).getInt("volumePercent", DEFAULT_VOLUME_PERCENT)
    }

    fun showVolumeDialog() {
        val labels = arrayOf("静音", "25%", "50%", "75%", "100%")
        val checked = VOLUME_LEVELS.indexOf(volumePercent).coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle("音量")
            .setSingleChoiceItems(labels, checked) { dialog: DialogInterface, which: Int ->
                applyVolume(VOLUME_LEVELS[which])
                dialog.dismiss()
            }
            .show()
    }

    private fun applyVolume(percent: Int) {
        volumePercent = percent
        volumeButton.invalidate()
        getSharedPreferences("settings", MODE_PRIVATE).edit().putInt("volumePercent", percent).apply()
    }

    // ── 存档 ────────────────────────────────────────────────────────────

    private fun loadStats() {
        val prefs = getSharedPreferences("stats", MODE_PRIVATE)
        totalHits = prefs.getInt("total", 0)
        todayDate = prefs.getString("date", "") ?: ""
        todayHits = if (todayDate == currentDate()) prefs.getInt("today", 0) else 0
        todayDate = currentDate()
        stateThresholds = parseThresholds(prefs.getString("thresholds", null))
    }

    private fun saveStats() {
        getSharedPreferences("stats", MODE_PRIVATE).edit()
            .putInt("total", totalHits)
            .putInt("today", todayHits)
            .putString("date", todayDate)
            .putString("thresholds", stateThresholds.joinToString(","))
            .apply()
    }

    private fun parseThresholds(raw: String?): IntArray {
        if (raw.isNullOrEmpty()) return IntArray(0)
        val parts = raw.split(",")
        val out = IntArray(parts.size)
        for (i in parts.indices) {
            out[i] = parts[i].trim().toIntOrNull() ?: return IntArray(0)
        }
        return out
    }

    private fun rollTodayIfNeeded() {
        val today = currentDate()
        if (today != todayDate) {
            todayDate = today
            todayHits = 0
        }
    }

    private fun currentDate(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    // ── 自绘视图 ────────────────────────────────────────────────────────

    /** 连击徽章：爆点垫底 + 连击数字，压在土豆右上角。 */
    private inner class StreakBadgeView(context: Context) : View(context) {
        private var contentW = 0
        private var contentH = 0
        private var burst: Bitmap? = null
        private var burstLeft = 0f
        private var burstTop = 0f
        private var digitXs = FloatArray(0)
        private var digitTop = 0f
        private var digitsText = ""

        fun update() {
            if (bursts.isEmpty()) return
            val d = resources.displayMetrics.density
            val digitH = STREAK_DIGIT_DP * d
            val overlap = DIGIT_OVERLAP_RATIO * digitH
            val s = streakHits.toString()
            digitsText = s

            var digitsW = 0f
            for (ch in s) streakDigits[ch - '0']?.let { digitsW += it.width }
            if (s.length > 1) digitsW -= (s.length - 1) * overlap

            burst = bursts[rng.nextInt(bursts.size)]
            val b = burst!!
            val pad = BADGE_PAD_RATIO * digitH
            contentW = (max(digitsW, b.width.toFloat()) + pad * 2).roundToInt()
            contentH = (max(digitH, b.height.toFloat()) + pad * 2).roundToInt()
            burstLeft = (contentW - b.width) / 2f
            burstTop = (contentH - b.height) / 2f
            digitTop = (contentH - digitH) / 2f

            digitXs = FloatArray(s.length)
            var x = (contentW - digitsW) / 2f
            for (i in s.indices) {
                val digit = streakDigits[s[i] - '0'] ?: continue
                digitXs[i] = x
                x += digit.width - overlap
            }
            requestLayout()
            invalidate()
            visibility = View.VISIBLE
        }

        override fun onMeasure(widthSpec: Int, heightSpec: Int) {
            setMeasuredDimension(contentW, contentH)
        }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            val d = resources.displayMetrics.density
            val half = POTATO_DP * d / 2f
            val potatoRight = rootView.width / 2f + half
            val potatoTop = rootView.height / 2f - half
            translationX = potatoRight + STREAK_RIGHT_OVERHANG_DP * d - w
            translationY = potatoTop - h
        }

        override fun onDraw(canvas: Canvas) {
            burst?.let { canvas.drawBitmap(it, burstLeft, burstTop, null) }
            for (i in digitsText.indices) {
                val b = streakDigits[digitsText[i] - '0'] ?: continue
                canvas.drawBitmap(b, digitXs[i], digitTop, null)
            }
        }
    }

    /** 今日暴打：金字 + 抱字 + 今日数字，贴在土豆正下方。 */
    private inner class TodayBadgeView(context: Context) : View(context) {
        private var contentW = 0
        private var contentH = 0
        private var jinX = 0f
        private var baoX = 0f
        private var digitXs = FloatArray(0)
        private var digitsText = ""

        init {
            update()
        }

        fun update() {
            val d = resources.displayMetrics.density
            val digitH = TODAY_DIGIT_DP * d
            val overlap = DIGIT_OVERLAP_RATIO * digitH
            val s = todayHits.toString()
            digitsText = s
            digitXs = FloatArray(s.length)

            var x = 2 * d
            labelJin?.let {
                jinX = x
                x += it.width + digitH * 0.1f
            }
            labelBao?.let {
                baoX = x
                x += it.width + digitH * 0.25f
            }

            var lastRight = 0f
            for (i in s.indices) {
                val b = todayDigits[s[i] - '0'] ?: continue
                digitXs[i] = x
                lastRight = b.width + x
                x = lastRight - overlap
            }
            contentW = (2 * d + lastRight).roundToInt()
            contentH = digitH.roundToInt()
            requestLayout()
            invalidate()
        }

        override fun onMeasure(widthSpec: Int, heightSpec: Int) {
            setMeasuredDimension(contentW, contentH)
        }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            val d = resources.displayMetrics.density
            val half = POTATO_DP * d / 2f
            val potatoLeft = rootView.width / 2f - half
            val potatoBottom = rootView.height / 2f + half
            translationX = potatoLeft + (POTATO_DP * d - w) / 2f
            translationY = potatoBottom + TODAY_GAP_ABOVE_DP * d
        }

        override fun onDraw(canvas: Canvas) {
            labelJin?.let { canvas.drawBitmap(it, jinX, 0f, null) }
            labelBao?.let { canvas.drawBitmap(it, baoX, 0f, null) }
            for (i in digitsText.indices) {
                val b = todayDigits[digitsText[i] - '0'] ?: continue
                canvas.drawBitmap(b, digitXs[i], 0f, null)
            }
        }
    }

    /**
     * 底部道具按钮：漫画贴纸质感 —— 硬阴影 + 纸白底 + 墨线描边 + 图标。
     * 零 emoji、零第三方素材，图标复用 PC 端同一份「水枪 / 中指」像素。
     */
    private inner class PropButtonView(context: Context, private val which: Int) : View(context) {
        private val ink = INK_COLOR
        private val paper = PAPER_COLOR
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = paper
            style = Paint.Style.FILL
        }
        private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
        private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            style = Paint.Style.FILL
        }
        private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
        private val bodyRect = RectF()
        private val shadowRect = RectF()
        private val srcRect = Rect()
        private val dstRect = RectF()

        init {
            contentDescription = if (which == PROP_SQUIRT) "水枪" else "中指"
            setOnClickListener { if (which == PROP_SQUIRT) squirt() else showFinger() }
        }

        override fun setPressed(pressed: Boolean) {
            val changed = isPressed != pressed
            super.setPressed(pressed)
            if (changed) invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val d = resources.displayMetrics.density
            val push = if (isPressed) d * PROP_PRESS_PUSH_DP else 0f
            val b = PROP_BORDER_DP * d
            val radius = PROP_RADIUS_DP * d
            val drop = PROP_SHADOW_DROP_DP * d
            val inset = b / 2f
            val sink = if (isPressed) 0.55f * drop else 0f

            shadowRect.set(inset, inset + drop - sink, width - inset, height - inset + drop - sink)
            canvas.drawRoundRect(shadowRect, radius, radius, shadowPaint)

            bodyRect.set(inset, inset, width - inset, height - inset)
            canvas.drawRoundRect(bodyRect, radius, radius, fillPaint)
            linePaint.strokeWidth = b
            canvas.drawRoundRect(bodyRect, radius, radius, linePaint)

            val bmp = if (which == PROP_SQUIRT) squirtIcon else fingerIcon
            if (bmp != null) {
                val avail = min(bodyRect.width(), bodyRect.height()) - PROP_ICON_PAD_DP * d * 2f
                if (avail > 0f) {
                    val scale = avail / max(bmp.width, bmp.height)
                    val w = bmp.width * scale
                    val h = bmp.height * scale
                    val left = bodyRect.centerX() - w / 2f
                    val top = bodyRect.centerY() - h / 2f + push
                    srcRect.set(0, 0, bmp.width, bmp.height)
                    dstRect.set(left, top, left + w, top + h)
                    canvas.drawBitmap(bmp, srcRect, dstRect, iconPaint)
                }
            }
        }
    }

    /** 音量按钮：自绘喇叭 + 声波弧（静音时画斜杠），不用 emoji。 */
    private inner class VolumeButtonView(context: Context) : View(context) {
        private val ink = INK_COLOR
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            style = Paint.Style.FILL
        }
        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            style = Paint.Style.STROKE
            strokeWidth = 2.2f
            strokeCap = Paint.Cap.ROUND
        }
        private val speaker = Path().apply {
            moveTo(3f, 9f)
            lineTo(8f, 9f)
            lineTo(14f, 4f)
            lineTo(14f, 20f)
            lineTo(8f, 15f)
            lineTo(3f, 15f)
            close()
        }
        private val arcRect = RectF()

        init {
            contentDescription = "音量"
            setOnClickListener { showVolumeDialog() }
        }

        override fun onDraw(canvas: Canvas) {
            val s = width / 24f
            canvas.save()
            canvas.scale(s, s)
            canvas.drawPath(speaker, fillPaint)
            if (volumePercent > 0) {
                arcRect.set(10.5f, 8.5f, 17.5f, 15.5f)
                canvas.drawArc(arcRect, -45f, 90f, false, strokePaint)
                arcRect.set(8f, 6f, 20f, 18f)
                canvas.drawArc(arcRect, -45f, 90f, false, strokePaint)
            } else {
                canvas.drawLine(4f, 4f, 21f, 21f, strokePaint)
            }
            canvas.restore()
        }
    }

    companion object {
        /** 与 PC 端一致的配色 */
        private const val BG_COLOR = 0xFFF1E7CF.toInt()
        private const val INK_COLOR = 0xFF221C15.toInt()
        private const val PAPER_COLOR = 0xFFFFFDF6.toInt()

        private const val FRAME_MS = 60L
        private const val HOLD_MS = 120L
        private const val POTATO_DP = 280
        private const val STATE_COUNT = 6
        private const val STREAK_RESET_MS = 6000L
        private const val STREAK_DIGIT_DP = 36f
        private const val TODAY_DIGIT_DP = 15f
        private const val DIGIT_OVERLAP_RATIO = 0.16f
        private const val BURST_HEIGHT_RATIO = 2.0f
        private const val BADGE_PAD_RATIO = 0.14f
        private const val STREAK_RIGHT_OVERHANG_DP = 25f
        private const val TODAY_GAP_ABOVE_DP = 4f
        private const val BADGE_POP_PEAK = 1.45f

        private const val VOLUME_75_SCALE = 0.1f
        private const val DEFAULT_VOLUME_PERCENT = 75
        private val VOLUME_LEVELS = intArrayOf(0, 25, 50, 75, 100)

        private val STATE_THRESHOLD_RANGES = arrayOf(
            intArrayOf(8, 15),
            intArrayOf(20, 35),
            intArrayOf(40, 65),
            intArrayOf(70, 100),
            intArrayOf(110, 130),
        )

        // ── 道具（照抄 PC 端常量，见 pc/BeatPotato/MainWindow.xaml.cs）──
        private const val SQUIRT_HITS_TO_WET = 5
        private const val SQUIRT_PROP_HOLD_MS = 300L
        private const val FINGER_PROP_HOLD_MS = 400L
        private const val WET_HOLD_MS = 4000L
        private const val SQUIRT_CONTENT_HEIGHT_RATIO = 0.62f
        private const val SQUIRT_OVERLAP_RATIO = 0.26f
        private const val SQUIRT_CENTER_Y_RATIO = 0.57f
        private const val SQUIRT_CONTENT_X_RATIO = 0.1578f
        private const val SQUIRT_CONTENT_Y_RATIO = 0.5559f
        private const val SQUIRT_CONTENT_H_RATIO = 0.4078f
        private const val SQUIRT_CONTENT_ASPECT = 677f / 522f
        private const val FINGER_CONTENT_HEIGHT_RATIO = 0.80f
        private const val FINGER_CONTENT_H_RATIO = 0.9355f
        private const val FINGER_CONTENT_CENTER_X_RATIO = 0.5098f
        private const val FINGER_CONTENT_CENTER_Y_RATIO = 0.5317f
        private const val FINGER_CONTENT_Y_RATIO = 0.60f
        private const val PROP_EDGE_MARGIN_DP = 6f

        private const val PROP_SQUIRT = 0
        private const val PROP_FINGER = 1
        private const val PROP_BUTTON_DP = 56f
        private const val PROP_BUTTON_GAP_DP = 18f
        private const val PROP_BAR_BOTTOM_DP = 56f
        private const val PROP_RADIUS_DP = 14f
        private const val PROP_BORDER_DP = 2.5f
        private const val PROP_SHADOW_DROP_DP = 3f
        private const val PROP_PRESS_PUSH_DP = 2f
        private const val PROP_ICON_PAD_DP = 7f

        // ── 台词 ──
        private const val RANDOM_LINE_PERCENT = 10
        private const val RANDOM_LINE_COOLDOWN_CLICKS_HIT = 30
        private const val RANDOM_LINE_COOLDOWN_CLICKS_PROP = 20
        private const val NODE_LINE_BLOCK_CLICKS = 10
        private const val SQUIRT_LINE_BLOCK_CLICKS = 10
        private const val LINE_WET_MS = 2036
        private const val LINE_STAGE2_MS = 2146
        private const val LINE_FINAL_MS = 936
        private val LINE_RANDOM_MS = intArrayOf(1407, 2989, 1547, 1409, 2444)
        private const val DEFAULT_LINE_MS = 1500

        // ── 展开图 ──
        private const val FLASH_HEIGHT_RATIO = 2.6f
        private const val FLASH_SCALE_FROM = 0.12f
        private const val FLASH_LEFT_RATIO = 0.5f
        private const val FLASH_GROW_MS = 150
        private const val FLASH_HOLD_MS = 500
        private const val FLASH_FADE_MS = 160
    }
}
