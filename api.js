var KEYPAY = {};

(function () {
	var ORIGIN = 'https://kpfrm.github.io',
		API_URL = 'https://kpembed.cc',
		PROGRESS_STEP = 10,
		MIN_PROGRESS_FOR_CREDIT = 50,
		callbacks = [],
		/**Options|{}*/opts = {},
		demoTitles = [],
		frame, isFrameListening, isPaid, trial, sign;

	KEYPAY.init = function (/**Options*/ options) {
		validate(opts, options);
		opts = options;

		if (sign) {
			trackStart()
		} else {
			getSign().then(trackStart)
		}

		var played = 0, prevTime = 0, reportProgress = PROGRESS_STEP, isCredited, was10s;
		opts.videoElement.addEventListener('timeupdate', function () {
			if (!opts.videoElement.duration) return;
			var d = opts.videoElement.currentTime - prevTime;
			prevTime = opts.videoElement.currentTime;
			if (d < 0 || d > 2) return;
			played += d;
			if (!was10s && played > 10) {
				sendProgress(1);
				was10s = true;
			}
			var preciseProgress = played / opts.videoElement.duration * 100,
				progress = Math.floor(preciseProgress / PROGRESS_STEP) * PROGRESS_STEP;
			if (progress >= reportProgress) {
				var cb = progress >= MIN_PROGRESS_FOR_CREDIT && !isCredited ? credit : null;
				sendProgress(progress, cb);
				reportProgress += PROGRESS_STEP;
			}
		});

		makeButton();
		getAuth();
		if (!isFrameListening) {
			addEventListener('message', messageListener);
			isFrameListening = true;
		}

		function credit() {
			if (isCredited) return;
			isCredited = true;
			try {
				KEYPAY.onCredit();
			} catch (e) {
			}
			if (trial && demoTitles.indexOf(opts.title) == -1) {
				trial--;
				demoTitles.push(opts.title);
				//todo postMessage if !trial
			}
		}
	};

	KEYPAY.initPlus = function (title) {
		opts.title = title;
		getAuth(title);
		if (!isFrameListening && window.BroadcastChannel) {
			var f = document.createElement('iframe');
			f.src = ORIGIN + '/plus.html';
			document.body.appendChild(f);
			addEventListener('message', messageListener);
			isFrameListening = true;
		}
	};

	KEYPAY.isPaid = function (title, cb) {
		callbacks.push(cb);
		if (callbacks.length < 2) {
			getAuth(title);
		}
	};

	KEYPAY.onStatusChange = function (isPaid) {
		console.log(isPaid);
	}

	KEYPAY.onCredit = function () {
		console.log('credit');
	}

	function validate(/**Options*/ opts, /**Options*/ options) {
		if (!options) throw 'provide options';
		if (!options.videoElement || !(options.videoElement instanceof HTMLMediaElement)) {
			throw 'provide correct options.videoElement';
		}
		if (!options.clientId) throw 'provide options.clientId';
		if (!options.title) throw 'provide options.title';
		if (opts.videoElement == options.videoElement && opts.title == options.title) {
			throw 'already initialized with same options';
		}
	}

	function getSign() {
		setTimeout(getSign, 1000 * 60 * 60);
		return fetch(
			API_URL + '/stat/hash',
			{ credentials: "include" }
		).then(function (r) {
			return r.json()
		}).then(function (r) {
			sign = '&hash=' + r.hash + '&time=' + r.time
		})
	}

	function trackStart() {
		if (opts.videoElement.paused) {
			opts.videoElement.addEventListener('playing', function h() {
				sendProgress(0);
				opts.videoElement.removeEventListener('playing', h);
			});
		} else {
			sendProgress(0);
		}
	}

	function sendProgress(p, cb) {
		if (!uid || !sign) return;
		var url = 'https://sttsnd.club/?progress=' + p +
			'&title=' + opts.title +
			'&duration=' + Math.round(opts.videoElement.duration) +
			'&wmid=' + opts.clientId +
			'&uid=' + uid + sign +
			'&domain=' + opts.domain;
		if (trial || ~demoTitles.indexOf(opts.title)) url += '&trial=1';
		if (opts.custom) url += '&custom=' + opts.custom;
		if (opts.group) url += '&group=' + opts.group;
		fetch(url).then(function (r) {
			if (r.status >= 200 && r.status < 300) {
				if (cb) cb();
			} else {
				throw r.status;
			}
		}).catch(function () {
			//todo break prev
			setTimeout(sendProgress.bind(null, p, cb), 60 * 1000);
		});
	}

	var statusCheckInterval = 1000 * 60 * 20,
		statusCheckTimer,
		uid;

	function getAuth(title) {
		title = title || opts.title;
		clearTimeout(statusCheckTimer);
		statusCheckTimer = setTimeout(getAuth, statusCheckInterval);
		fetch(
			API_URL + '/auth/identity',
			{ credentials: "include" }
		).then(function (r) {
			return r.json();
		}).then(function (r) {
			var u = r.user;
			demoTitles = u["free_items"].map(function (i) {
				return i.title;
			});
			if (~demoTitles.indexOf(title) || u["free_video"] || u["premium_time"] > Date.now()) {
				meetPremium(u.id, u["free_video"], u["premium_time"]);
			} else {
				throw 'ad';
			}
		}).catch(function (e) {
			if (e != 'ad') uid = null;
			updateStatus();
		})
	}

	function messageListener(/**MessageEvent*/ e) {
		if (e.origin !== ORIGIN || !e.data) return;
		if ('close' === e.data.event) {
			if (frame) frame.style.display = 'none';
			return;
		}
		if ('logout' === e.data.event) {
			uid = null;
			updateStatus();
			return;
		}
		if (e.data.event === 'premium' || 'trial?' === e.data.event) {
			clearTimeout(statusCheckTimer);
			statusCheckTimer = setTimeout(getAuth, statusCheckInterval);
			if (e.data.titles) demoTitles = e.data.titles;
			if (e.data.endTime || e.data.count || ~demoTitles.indexOf(opts.title)) {
				meetPremium(e.data.id, e.data.count, e.data.endTime);
			}
		}
	}

	function meetPremium(id, count, endTime) {
		uid = id;
		updateStatus(true);
		if (count || ~demoTitles.indexOf(opts.title)) {
			trial = count;
		} else {
			trial = 0;
			var toEnd = Date.now() - endTime;
			if (toEnd < statusCheckInterval) {
				setTimeout(getAuth, toEnd);
			}
		}
	}

	function updateStatus(isPaidNow) {
		if (isPaid != isPaidNow) {
			try {
				KEYPAY.onStatusChange(isPaidNow);
			} catch (e) {
			}
		}
		isPaid = isPaidNow;
		while (callbacks.length) {
			try {
				callbacks.shift()(isPaidNow);
			} catch (e) {
			}
		}
	}

	function makeButton() {
		if (KEYPAY.button && KEYPAY.button.parentElement === document.body) {
			return;
		}
		appendStyles();
		var b = document.createElement('button');
		b.className = 'keypay-btn';
		b.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">\n' +
			'<path d="M13.5 16.9c4.3-2.5 5.8-8.1 3.3-12.4C15.5 2.3 13.5.8 11.3.2c.2 1.1.2 2.2-.1 3.2 1.4.2 2.7 1 3.6 2.2L12 7.3c-.9-.7-2-.9-2.9-.4l-3.3 2 .8 1.5L3.8 12 .5 6c-.8 2.4-.7 5.2.7 7.6C2.6 16 4.9 17.5 7.4 18l-2.8-4.9 2.8-1.6.8 1.5 3.3-1.9c.9-.5 1.3-1.6 1.1-2.6l2.8-1.7c1.1 2.6.1 5.6-2.3 7.1l-3.3 1.9 1.2 2.1c.9-.2 1.7-.5 2.5-1zM2.4 2.8L4.2 6l2.1-1.2C8 3.8 8.6 1.7 7.8 0 6.7.1 5.6.5 4.5 1.1c-.8.5-1.5 1.1-2.1 1.7z" fill="#3b63ff"/>\n' +
			'</svg>Premium';
		b.onclick = function () {
			if (frame) {
				frame.style.display = 'block';
			} else {
				frame = document.createElement('iframe');
				frame.src = ORIGIN + '/frame.html';
				frame.style.position = 'fixed';
				frame.style.top = '0';
				frame.style.height = '100%';
				frame.style.width = '100%';
				frame.style.zIndex = '1000';
				frame.style.border = '0';
				document.body.appendChild(frame);
			}
		};
		document.body.appendChild(b);
		KEYPAY.button = b;
	}

	function appendStyles() {
		var style = document.head.querySelector('style') || document.createElement('style');
		style.innerHTML += '.keypay-btn{font-family:Arial,Helvetica,sans-serif;display:inline-flex;justify-content:flex-start;align-items:center;font-weight:500;text-align:center;vertical-align:middle;touch-action:manipulation;cursor:pointer;background-image:none;border:1px solid transparent;white-space:nowrap;line-height:1.5;user-select:none;outline:none;position:absolute;top:2px;right:100px;padding:4px;max-width:28px;font-size:12px;overflow:hidden;color:#3B63FF;background-color:#fff;border-radius:0 0 5px 5px;transition:max-width .25s ease-in-out}' +
			'.keypay-btn svg{flex-shrink:0;margin-right:5px}' +
			'.keypay-btn:hover{max-width:300px}';
		if (!style.parentNode) document.head.appendChild(style);
	}
})();
