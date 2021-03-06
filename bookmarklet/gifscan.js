var bitsToNum = function (ba) {
	return ba.reduce(function (s, n) {
		return s * 2 + n;
	}, 0);
};

var byteToBitArr = function (bite) {
	var a = [];
	for (var i = 7; i >= 0; i--) {
		a.push( !! (bite & (1 << i)));
	}
	return a;
};

// Stream
/**
 * @constructor
 */
// Make compiler happy.
var Stream = function (data) {
	this.data = data;
	this.len = this.data.length;
	this.pos = 0;

	this.readByte = function () {
		if (this.pos >= this.data.length) {
			throw new Error('Attempted to read past end of stream.');
		}
		return data.charCodeAt(this.pos++) & 0xFF;
	};

	this.readBytes = function (n) {
		var bytes = [];
		for (var i = 0; i < n; i++) {
			bytes.push(this.readByte());
		}
		return bytes;
	};

	this.read = function (n) {
		var s = '';
		for (var i = 0; i < n; i++) {
			s += String.fromCharCode(this.readByte());
		}
		return s;
	};

	this.readUnsigned = function () { // Little-endian.
		var a = this.readBytes(2);
		return (a[1] << 8) + a[0];
	};
};

var lzwDecode = function (minCodeSize, data) {
	// TODO: Now that the GIF parser is a bit different, maybe this should get an array of bytes instead of a String?
	var pos = 0; // Maybe this streaming thing should be merged with the Stream?
	var readCode = function (size) {
		var code = 0;
		for (var i = 0; i < size; i++) {
			if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
				code |= 1 << i;
			}
			pos++;
		}
		return code;
	};

	var output = [];

	var clearCode = 1 << minCodeSize;
	var eoiCode = clearCode + 1;

	var codeSize = minCodeSize + 1;

	var dict = [];

	var clear = function () {
		dict = [];
		codeSize = minCodeSize + 1;
		for (var i = 0; i < clearCode; i++) {
			dict[i] = [i];
		}
		dict[clearCode] = [];
		dict[eoiCode] = null;

	};

	var code;
	var last;

	while (true) {
		last = code;
		code = readCode(codeSize);

		if (code === clearCode) {
			clear();
			continue;
		}
		if (code === eoiCode) break;

		if (code < dict.length) {
			if (last !== clearCode) {
				dict.push(dict[last].concat(dict[code][0]));
			}
		}
		else {
			if (code !== dict.length) throw new Error('Invalid LZW code.');
			dict.push(dict[last].concat(dict[last][0]));
		}
		output.push.apply(output, dict[code]);

		if (dict.length === (1 << codeSize) && codeSize < 12) {
			// If we're at the last code and codeSize is 12, the next code will be a clearCode, and it'll be 12 bits long.
			codeSize++;
		}
	}

	// I don't know if this is technically an error, but some GIFs do it.
	//if (Math.ceil(pos / 8) !== data.length) throw new Error('Extraneous LZW bytes.');
	return output;
};


// The actual parsing; returns an object with properties.
var parseGIF = function (st, handler) {
	handler || (handler = {});

	// LZW (GIF-specific)
	var parseCT = function (entries) { // Each entry is 3 bytes, for RGB.
		var ct = [];
		for (var i = 0; i < entries; i++) {
			ct.push(st.readBytes(3));
		}
		return ct;
	};

	var readSubBlocks = function () {
		var size, data;
		data = '';
		do {
			size = st.readByte();
			data += st.read(size);
		} while (size !== 0);
		return data;
	};

	var parseHeader = function () {
		var hdr = {};
		hdr.sig = st.read(3);
		hdr.ver = st.read(3);
		if (hdr.sig !== 'GIF') throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
		hdr.width = st.readUnsigned();
		hdr.height = st.readUnsigned();

		var bits = byteToBitArr(st.readByte());
		hdr.gctFlag = bits.shift();
		hdr.colorRes = bitsToNum(bits.splice(0, 3));
		hdr.sorted = bits.shift();
		hdr.gctSize = bitsToNum(bits.splice(0, 3));

		hdr.bgColor = st.readByte();
		hdr.pixelAspectRatio = st.readByte(); // if not 0, aspectRatio = (pixelAspectRatio + 15) / 64
		if (hdr.gctFlag) {
			hdr.gct = parseCT(1 << (hdr.gctSize + 1));
		}
		handler.hdr && handler.hdr(hdr);
	};

	var parseExt = function (block) {
		var parseGCExt = function (block) {
			var blockSize = st.readByte(); // Always 4
			var bits = byteToBitArr(st.readByte());
			block.reserved = bits.splice(0, 3); // Reserved; should be 000.
			block.disposalMethod = bitsToNum(bits.splice(0, 3));
			block.userInput = bits.shift();
			block.transparencyGiven = bits.shift();

			block.delayTime = st.readUnsigned();

			block.transparencyIndex = st.readByte();

			block.terminator = st.readByte();

			handler.gce && handler.gce(block);
		};

		var parseComExt = function (block) {
			block.comment = readSubBlocks();
			handler.com && handler.com(block);
		};

		var parsePTExt = function (block) {
			// No one *ever* uses this. If you use it, deal with parsing it yourself.
			var blockSize = st.readByte(); // Always 12
			block.ptHeader = st.readBytes(12);
			block.ptData = readSubBlocks();
			handler.pte && handler.pte(block);
		};

		var parseAppExt = function (block) {
			var parseNetscapeExt = function (block) {
				var blockSize = st.readByte(); // Always 3
				block.unknown = st.readByte(); // ??? Always 1? What is this?
				block.iterations = st.readUnsigned();
				block.terminator = st.readByte();
				handler.app && handler.app.NETSCAPE && handler.app.NETSCAPE(block);
			};

			var parseUnknownAppExt = function (block) {
				block.appData = readSubBlocks();
				// FIXME: This won't work if a handler wants to match on any identifier.
				handler.app && handler.app[block.identifier] && handler.app[block.identifier](block);
			};

			var blockSize = st.readByte(); // Always 11
			block.identifier = st.read(8);
			block.authCode = st.read(3);
			switch (block.identifier) {
			case 'NETSCAPE':
				parseNetscapeExt(block);
				break;
			default:
				parseUnknownAppExt(block);
				break;
			}
		};

		var parseUnknownExt = function (block) {
			block.data = readSubBlocks();
			handler.unknown && handler.unknown(block);
		};

		block.label = st.readByte();
		switch (block.label) {
		case 0xF9:
			block.extType = 'gce';
			parseGCExt(block);
			break;
		case 0xFE:
			block.extType = 'com';
			parseComExt(block);
			break;
		case 0x01:
			block.extType = 'pte';
			parsePTExt(block);
			break;
		case 0xFF:
			block.extType = 'app';
			parseAppExt(block);
			break;
		default:
			block.extType = 'unknown';
			parseUnknownExt(block);
			break;
		}
	};

	var parseImg = function (img) {
		var deinterlace = function (pixels, width) {
			// Of course this defeats the purpose of interlacing. And it's *probably*
			// the least efficient way it's ever been implemented. But nevertheless...
			var newPixels = new Array(pixels.length);
			var rows = pixels.length / width;
			var cpRow = function (toRow, fromRow) {
				var fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
				newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
			};

			// See appendix E.
			var offsets = [0, 4, 2, 1];
			var steps = [8, 8, 4, 2];

			var fromRow = 0;
			for (var pass = 0; pass < 4; pass++) {
				for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
					cpRow(toRow, fromRow)
					fromRow++;
				}
			}

			return newPixels;
		};

		img.leftPos = st.readUnsigned();
		img.topPos = st.readUnsigned();
		img.width = st.readUnsigned();
		img.height = st.readUnsigned();

		var bits = byteToBitArr(st.readByte());
		img.lctFlag = bits.shift();
		img.interlaced = bits.shift();
		img.sorted = bits.shift();
		img.reserved = bits.splice(0, 2);
		img.lctSize = bitsToNum(bits.splice(0, 3));

		if (img.lctFlag) {
			img.lct = parseCT(1 << (img.lctSize + 1));
		}

		img.lzwMinCodeSize = st.readByte();

		var lzwData = readSubBlocks();

		img.pixels = lzwDecode(img.lzwMinCodeSize, lzwData);

		if (img.interlaced) { // Move
			img.pixels = deinterlace(img.pixels, img.width);
		}

		handler.img && handler.img(img);
	};

	var parseBlock = function () {
		var block = {};
		block.sentinel = st.readByte();

		switch (String.fromCharCode(block.sentinel)) { // For ease of matching
		case '!':
			block.type = 'ext';
			parseExt(block);
			break;
		case ',':
			block.type = 'img';
			parseImg(block);
			break;
		case ';':
			block.type = 'eof';
			handler.eof && handler.eof(block);
			break;
		default:
			throw new Error('Unknown block: 0x' + block.sentinel.toString(16)); // TODO: Pad this with a 0.
		}

		if (block.type !== 'eof') setTimeout(parseBlock, 0);
	};

	var parse = function () {
		parseHeader();
		setTimeout(parseBlock, 0);
	};

	parse();
};


var SuperGif = function ( opts ) {
	var options = {
		//viewport position
		vp_l: 0,
		vp_t: 0,
		vp_w: null,
		vp_h: null,
		//canvas sizes
		c_w: null,
		c_h: null
	};
	for (var i in opts ) { options[i] = opts[i] }
	if (options.vp_w && options.vp_h) options.is_vp = true;

	var stream;
	var hdr;

	var loadError = null;
	var loading = false;

	var transparency = null;
	var delay = null;
	var disposalMethod = null;
	var disposalRestoreFromIdx = 0;
	var lastDisposalMethod = null;
	var frame = null;
	var lastImg = null;

	var playing = true;
	var forward = true;

	var ctx_scaled = false;

	var frames = [];

	var gif = options.gif;
	if (typeof options.auto_play == 'undefined') 
		options.auto_play = (!gif.getAttribute('rel:auto_play') || gif.getAttribute('rel:auto_play') == '1');

	var clear = function () {
		transparency = null;
		delay = null;
		lastDisposalMethod = disposalMethod;
		disposalMethod = null;
		frame = null;
	};

	// XXX: There's probably a better way to handle catching exceptions when
	// callbacks are involved.
	var doParse = function () {
		try {
			parseGIF(stream, handler);
		}
		catch (err) {
			doLoadError('parse');
		}
	};

	var doText = function (text) {
		toolbar.innerHTML = text; // innerText? Escaping? Whatever.
		toolbar.style.visibility = 'visible';
	};

	var setSizes = function(w, h) {
		canvas.width = w * get_canvas_scale();
		canvas.height = h * get_canvas_scale();
		toolbar.style.minWidth = ( w * get_canvas_scale() ) + 'px';

		tmpCanvas.width = w;
		tmpCanvas.height = h;
		tmpCanvas.style.width = w + 'px';
		tmpCanvas.style.height = h + 'px';
		tmpCanvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
	}

	var doShowProgress = function (pos, length, draw) {
		if (draw) {
			var height = 25;
			var left, mid, top, width;
			if (options.is_vp) {
				if (!ctx_scaled) {
					top = (options.vp_t + options.vp_h - height);
					height = height;
					left = options.vp_l;
					mid = left + (pos / length) * options.vp_w;
					width = canvas.width;
				} else {
					top = (options.vp_t + options.vp_h - height) / get_canvas_scale();
					height = height / get_canvas_scale();
					left = (options.vp_l / get_canvas_scale() );
					mid = left + (pos / length) * (options.vp_w / get_canvas_scale());
					width = canvas.width / get_canvas_scale();
				}
				//some debugging, draw rect around viewport
				if (false) {
					if (!ctx_scaled) {
						var l = options.vp_l, t = options.vp_t;
						var w = options.vp_w, h = options.vp_h;
					} else {
						var l = options.vp_l/get_canvas_scale(), t = options.vp_t/get_canvas_scale();
						var w = options.vp_w/get_canvas_scale(), h = options.vp_h/get_canvas_scale();
					}
					ctx.rect(l,t,w,h);
					ctx.stroke();
				}
			}
			else {
				top = canvas.height - height;
				mid = (pos / length) * canvas.width;
				width = canvas.width;
			}
			// XXX Figure out alpha fillRect.
			//ctx.fillStyle = 'salmon';
			ctx.fillStyle = 'rgba(255,255,255,0.4)';
			ctx.fillRect(mid, top, width - mid, height);

			//ctx.fillStyle = 'teal';
			ctx.fillStyle = 'rgba(255,0,22,.8)';
			ctx.fillRect(0, top, mid, height);
		}
	};

	var doLoadError = function (originOfError) {
		var drawError = function () {
			ctx.fillStyle = 'black';
			ctx.fillRect(0, 0, options.c_w ? options.c_w : hdr.width, options.c_h ? options.c_h : hdr.height);
			ctx.strokeStyle = 'red';
			ctx.lineWidth = 3;
			ctx.moveTo(0, 0);
			ctx.lineTo(options.c_w ? options.c_w : hdr.width, options.c_h ? options.c_h : hdr.height);
			ctx.moveTo(0, options.c_h ? options.c_h : hdr.height);
			ctx.lineTo(options.c_w ? options.c_w : hdr.width, 0);
			ctx.stroke();
		};

		loadError = originOfError;
		hdr = {
			width: gif.width,
			height: gif.height
		}; // Fake header.
		frames = [];
		drawError();
	};

	var doHdr = function (_hdr) {
		hdr = _hdr;
		setSizes(hdr.width, hdr.height)
	};

	var doGCE = function (gce) {
		pushFrame();
		clear();
		transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
		delay = gce.delayTime;
		disposalMethod = gce.disposalMethod;
		// We don't have much to do with the rest of GCE.
	};

	var pushFrame = function () {
		if (!frame) return;
		frames.push({
			data: frame.getImageData(0, 0, hdr.width, hdr.height),
			delay: delay
		});
	};

	var doImg = function (img) {
		if (!frame) frame = tmpCanvas.getContext('2d');

		var currIdx = frames.length;

		//ct = color table, gct = global color table
		var ct = img.lctFlag ? img.lct : hdr.gct; // TODO: What if neither exists?

		/*
		Disposal method indicates the way in which the graphic is to
		be treated after being displayed.

		Values :    0 - No disposal specified. The decoder is
						not required to take any action.
					1 - Do not dispose. The graphic is to be left
						in place.
					2 - Restore to background color. The area used by the
						graphic must be restored to the background color.
					3 - Restore to previous. The decoder is required to
						restore the area overwritten by the graphic with
						what was there prior to rendering the graphic.

						Importantly, "previous" means the frame state
						after the last disposal of method 0, 1, or 2.
		*/
		if (currIdx > 0) {
			if (lastDisposalMethod === 3) {
				// Restore to previous
				frame.putImageData(frames[disposalRestoreFromIdx].data, 0, 0);
			} else {
				disposalRestoreFromIdx = currIdx - 1;
			}

			if (lastDisposalMethod === 2) {
				// Restore to background color
				// Browser implementations historically restore to transparent; we do the same.
				// http://www.wizards-toolkit.org/discourse-server/viewtopic.php?f=1&t=21172#p86079
				frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
			}
		}
		// else, Undefined/Do not dispose.
		// frame contains final pixel data from the last frame; do nothing

		//Get existing pixels for img region after applying disposal method
		var imgData = frame.getImageData(img.leftPos, img.topPos, img.width, img.height);

		//apply color table colors
		var cdd = imgData.data;
		img.pixels.forEach(function (pixel, i) {
			// imgData.data === [R,G,B,A,R,G,B,A,...]
			if (pixel !== transparency) {
				cdd[i * 4 + 0] = ct[pixel][0];
				cdd[i * 4 + 1] = ct[pixel][1];
				cdd[i * 4 + 2] = ct[pixel][2];
				cdd[i * 4 + 3] = 255; // Opaque.
			}
		});
		imgData.data = cdd;

		frame.putImageData(imgData, img.leftPos, img.topPos);

		if (!ctx_scaled) {
			ctx.scale(get_canvas_scale(),get_canvas_scale());
			ctx_scaled = true;
		}

		// We could use the on-page canvas directly, except that we draw a progress
		// bar for each image chunk (not just the final image).
		ctx.drawImage(tmpCanvas, 0, 0);

		lastImg = img;
	};

	var player = (function () {
		var i = -1;
		var curFrame;
		var delayInfo;

		var showingInfo = false;
		var pinned = false;

		var stepFrame = function (delta) { // XXX: Name is confusing.
			i = (i + delta + frames.length) % frames.length;
			curFrame = i + 1;
			delayInfo = frames[i].delay;
			putFrame();
		};

		var step = (function () {
			var stepping = false;

			var doStep = function () {
				stepping = playing;
				if (!stepping) return;

				stepFrame(forward ? 1 : -1);
				var delay = frames[i].delay * 10;
				if (!delay) delay = 100; // FIXME: Should this even default at all? What should it be?
				setTimeout(doStep, delay);
			};

			return function () {
				if (!stepping) setTimeout(doStep, 0);
			};
		}());

		var putFrame = function () {
			curFrame = i;

			tmpCanvas.getContext("2d").putImageData(frames[i].data, 0, 0);
			ctx.globalCompositeOperation = "copy";
			ctx.drawImage(tmpCanvas, 0, 0);

		};

		var play = function () {
			playing = true;
			step();
		};

		var pause = function () {
			playing = false;
		};


		return {
			init: function () {
				if (loadError) return;

				if ( ! (options.c_w && options.c_h) ) {
					ctx.scale(get_canvas_scale(),get_canvas_scale());
				}

				if (options.auto_play) {
					step();
				}
				else {
					i = 0;
					putFrame();
				}
			},
			current_frame: curFrame,
			step: step,
			play: play,
			pause: pause,
			playing: playing,
			move_relative: stepFrame,
			current_frame: function() { return i; },
			length: function() { return frames.length },
			move_to: function ( frame_idx ) {
				i = frame_idx;
				putFrame();
			}
		}
	}());

	var doDecodeProgress = function (draw) {
		doShowProgress(stream.pos, stream.data.length, draw);
	};

	var doNothing = function () {};
	/**
	 * @param{boolean=} draw Whether to draw progress bar or not; this is not idempotent because of translucency.
	 *                       Note that this means that the text will be unsynchronized with the progress bar on non-frames;
	 *                       but those are typically so small (GCE etc.) that it doesn't really matter. TODO: Do this properly.
	 */
	var withProgress = function (fn, draw) {
		return function (block) {
			fn(block);
			doDecodeProgress(draw);
		};
	};


	var handler = {
		hdr: withProgress(doHdr),
		gce: withProgress(doGCE),
		com: withProgress(doNothing),
		// I guess that's all for now.
		app: {
			// TODO: Is there much point in actually supporting iterations?
			NETSCAPE: withProgress(doNothing)
		},
		img: withProgress(doImg, true),
		eof: function (block) {
			//toolbar.style.display = '';
			pushFrame();
			doDecodeProgress(false);
			if ( ! (options.c_w && options.c_h) ) {
				canvas.width = hdr.width * get_canvas_scale();
				canvas.height = hdr.height * get_canvas_scale();
			}
			player.init();
			loading = false;
			if (load_callback) {
				load_callback();
			}

		}
	};

	var init = function () {
		var parent = gif.parentNode;

		var div = document.createElement('div');
		canvas = document.createElement('canvas');
		ctx = canvas.getContext('2d');
		toolbar = document.createElement('div');

		tmpCanvas = document.createElement('canvas');

		div.width = canvas.width = gif.width;
		div.height = canvas.height = gif.height;
		toolbar.style.minWidth = gif.width + 'px';

		div.className = 'jsgif';
		toolbar.className = 'jsgif_toolbar';
		div.appendChild(canvas);
		div.appendChild(toolbar);

		parent.insertBefore(div, gif);
		parent.removeChild(gif);

		if (options.c_w && options.c_h) setSizes(options.c_w, options.c_h);
	};

	var get_canvas_scale = function() {
		var scale;
		if (options.max_width && hdr) {
			scale = options.max_width / hdr.width;
		}
		else {
			scale = 1;
		}
		return scale;
	}

	var canvas, ctx, toolbar, tmpCanvas;
	var initialized = false;
	var load_callback = false;

	return {
		// play controls
		play: player.play,
		pause: player.pause,
		move_relative: player.move_relative,
		move_to: player.move_to,

		// getters for instance vars
		get_frames 		 : function() { return frames },
		get_playing      : function() { return player.playing },
		get_canvas       : function() { return canvas },
		get_canvas_scale : function() { return get_canvas_scale() },
		get_loading      : function() { return loading },
		get_auto_play    : function() { return options.auto_play },
		get_length       : function() { return player.length() },
		get_current_frame: function() { return player.current_frame() },
		load: function (callback) {

			if (callback) load_callback = callback;
			loading = true;

			var h = new XMLHttpRequest();
			h.overrideMimeType('text/plain; charset=x-user-defined');
			h.onloadstart = function() {
				// Wait until connection is oppened to replace the gif element with a canvas to avoid a blank img
				if (!initialized ) init();
			};
			h.onload = function(e) {
				stream = new Stream(h.responseText);
				setTimeout(doParse, 0);
			};
			h.onprogress = function (e) {
				if (e.lengthComputable) doShowProgress(e.loaded, e.total, true);
			};
			h.onerror = function() { doLoadError('xhr'); };
			h.open('GET', gif.getAttribute('rel:animated_src') || gif.src, true);
			h.send();

		}
	};	

};

if ( !window.getQueryString ) {
	window.getQueryString = function(key, default_){
		if (default_==null) default_=""; 
		key = key.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
		var regex = new RegExp("[\\?&]"+key+"=([^&#]*)");
		var qs = regex.exec(window.location.href);
		if(qs == null)
			return default_;
		else
			return qs[1];
	}
}

if ( !window.requestAnimationFrame ) {
	window.requestAnimationFrame = ( function() {
		return window.webkitRequestAnimationFrame ||
		window.mozRequestAnimationFrame ||
		window.oRequestAnimationFrame ||
		window.msRequestAnimationFrame ||
		function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element ) {

			window.setTimeout( callback, 1000 / 60 );

		};
	} )();
}

// add bind method for browsers that don't currently support it
if (!Function.prototype.bind) {  
  Function.prototype.bind = function (oThis) {  
	if (typeof this !== "function") {  
	  // closest thing possible to the ECMAScript 5 internal IsCallable function  
	  throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");  
	}  
  
	var aArgs = Array.prototype.slice.call(arguments, 1),   
		fToBind = this,   
		fNOP = function () {},  
		fBound = function () {  
		  return fToBind.apply(this instanceof fNOP  
								 ? this  
								 : oThis || window,  
							   aArgs.concat(Array.prototype.slice.call(arguments)));  
		};  
  
	fNOP.prototype = this.prototype;  
	fBound.prototype = new fNOP();  
  
	return fBound;  
  };  
}

/**
 * Amazing description of gifscan.js goes here
 */

// UTILS!
// 
if ( !window.getQueryString ) {
	window.getQueryString = function(key, default_){
		if (default_==null) default_=""; 
		key = key.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
		var regex = new RegExp("[\\?&]"+key+"=([^&#]*)");
		var qs = regex.exec(window.location.href);
		if(qs == null)
			return default_;
		else
			return qs[1];
	}
}

if ( !window.requestAnimationFrame ) {
	window.requestAnimationFrame = ( function() {
		return window.webkitRequestAnimationFrame ||
		window.mozRequestAnimationFrame ||
		window.oRequestAnimationFrame ||
		window.msRequestAnimationFrame ||
		function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element ) {

			window.setTimeout( callback, 1000 / 60 );

		};
	} )();
}

// add bind method for browsers that don't currently support it
if (!Function.prototype.bind) {  
  Function.prototype.bind = function (oThis) {  
	if (typeof this !== "function") {  
	  // closest thing possible to the ECMAScript 5 internal IsCallable function  
	  throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");  
	}  
  
	var aArgs = Array.prototype.slice.call(arguments, 1),   
		fToBind = this,   
		fNOP = function () {},  
		fBound = function () {  
		  return fToBind.apply(this instanceof fNOP  
								 ? this  
								 : oThis || window,  
							   aArgs.concat(Array.prototype.slice.call(arguments)));  
		};  
  
	fNOP.prototype = this.prototype;  
	fBound.prototype = new fNOP();  
  
	return fBound;  
  };  
}

// very hack-y gif parser!
var GifParser = function (argument) {
	this.frames = [];
	var imagedata = null;
	
	// quick hack :/
	function compareImages(img1,img2){
	   if(img1.data.length != img2.data.length)
	       return false;
	   for(var i = 0; i < img1.data.length; ++i){
	       if(img1.data[i] != img2.data[i])
	           return false;
	   }
	   return true;   
	}
	this.load = function(url){
		this.canvas = document.createElement("canvas");
		this.imgElement = document.createElement('img');
		this.imgElement.onload = this.parse.bind(this);
		this.imgElement.id  = "gifscan_parse";
		this.imgElement.src = url; // to-do: error checking!
	}
	this.parse = function(){
		this.canvas.width = this.imgElement.width;
		this.canvas.height = this.imgElement.height;
		this.canvas.getContext("2d").drawImage( this.imgElement, 0, 0);
		var id = this.canvas.getImageData(0,0,this.canvas.width, this.canvas.height);
		if ( !compareImages(id, imagedata) ){
			imagedata = id;
			this.frames.push(id);
		}
		this.setTimeout(this.parse.bind(this), 0);
	}
}

/**
 * @class GifScan
 */
var GifScan = function(){
	this.speed = 1; // increase 1 frame every frame!
	this.play = true;
}

GifScan.prototype.load = function( src ) {
	if ( src instanceof Image ){
		this.imgElement = src;
		this.onLoaded();
	} else {
		// see libgif.js for explanation of this part!
		this.imgElement = document.createElement('img');
		this.imgElement.onload = this.onLoaded.bind(this);
		this.imgElement.setAttribute("rel:animated_src", src);
		this.imgElement.setAttribute("rel:auto_play", "0");
		this.imgElement.id  = "gifscan";
		this.imgElement.src = src; // to-do: error checking!
		document.body.appendChild(this.imgElement);
	}
};

GifScan.prototype.onLoaded = function() {
	this.parser = new SuperGif({ gif: this.imgElement, auto_play: false } );
	this.parser.load(this.onParsed.bind(this));
	this.parser.get_canvas().style.visibility = "hidden";
	try {
		var parent = this.imgElement.parentNode;
		parent.removeChild(this.imgElement);
	}
	catch(e){

	}
};

GifScan.prototype.onParsed = function() {
	// supergif is done parsing!
	this.scanCanvas = document.createElement("canvas");
	this.scanCanvas.width = this.parser.get_canvas().width;
	this.scanCanvas.height = this.parser.get_canvas().height;
	this.scanCanvas.style.position = "absolute";
	this.scanCanvas.style.left = "0px";
	this.scanCanvas.style.top = "0px";
	this.scanCanvas.style.width = "100%";
	this.scanCanvas.style.height = "100%";
	document.body.appendChild(this.scanCanvas);

	// playback props
	this.ctx = this.scanCanvas.getContext("2d");
	this.gifCtx = this.parser.get_canvas().getContext("2d");
	this.x = 0;
	this.width = this.scanCanvas.width;
	this.height = this.scanCanvas.height;
	this.currentFrame = 0;
	this.length = this.parser.get_length();
	this.slice = this.ctx.createImageData(1,this.height);

	if ( this.play ){
		requestAnimationFrame(this.playingLoop.bind(this));
	} else {
		requestAnimationFrame(this.loop.bind(this));
	}
};

GifScan.prototype.loop = function() {
	// set image data based on current gif frame
	var imageData = this.gifCtx.getImageData( this.x % this.width, 0, 1, this.scanCanvas.height );
	this.ctx.putImageData(imageData, this.x % this.width, 0);//, this.x % this.width, 0, 1, this.scanCanvas.height);

	// next frame in gif
	this.currentFrame = ( this.currentFrame + this.speed ) % this.length;
	this.parser.move_to( Math.floor( this.currentFrame ));
	this.x++;

	requestAnimationFrame(this.loop.bind(this));
};

var logged = false;

GifScan.prototype.playingLoop = function() {
	// set each slice based on steps
	var sc = this.length/this.width;
	this.scanCanvas.width = this.scanCanvas.width;
	for ( var i=0; i<this.width; i++){
		var curX = (i + this.x) % this.width;
		var idx = parseInt(this.currentFrame + i) % this.length;
		var data = this.parser.get_frames()[idx].data.data;
		for (var y=0; y<this.height; y++){
			var ix = (curX + y * this.width) * 4;
			var sidx = y * 4;
			this.slice.data[sidx + 0]	= data[ix + 0];
			this.slice.data[sidx + 1]	= data[ix + 1];
			this.slice.data[sidx + 2]	= data[ix + 2];
			this.slice.data[sidx + 3]	= data[ix + 3];
		}

		this.ctx.putImageData( this.slice, i, 0);
	}

	logged = true;

	// next frame in gif
	this.currentFrame = ( this.currentFrame + this.speed ) % this.length;
	// this.parser.move_to( Math.floor( this.currentFrame ));
	//this.x++;

	requestAnimationFrame(this.playingLoop.bind(this));
};

(function () {
	var gifscan = new GifScan();
	// loop through types on page!
	var imgs = document.getElementsByTagName('img');
	for ( var i=0; i<imgs.length; i++ ){
		if ( imgs[i].src.indexOf("gif") != -1){
			gifscan.load( imgs[i].src );
			var parent = imgs[i].parentNode;
			parent.removeChild(imgs[i]);
			break;
		}
	}
}) ();