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

GifScan.prototype.playingLoop = function() {
	// set each slice based on steps
	for ( var i=0; i<this.width; i++){
		var curX = (i + this.x) % this.width;
		var idx = parseInt(( i + this.currentFrame ) % this.length);
		var data = this.parser.get_frames()[idx].data.data;
		for (var y=0; y<this.height; y++){
			var idx = (curX + y * this.width) * 4;
			var sidx = y * 4;
			this.slice.data[sidx + 0]	= data[idx + 0];
			this.slice.data[sidx + 1]	= data[idx + 1];
			this.slice.data[sidx + 2]	= data[idx + 2];
			this.slice.data[sidx + 3]	= data[idx + 3];
		}

		this.ctx.putImageData( this.slice, i, 0);
	}

	// next frame in gif
	this.currentFrame = ( this.currentFrame + this.speed ) % this.length;
	// this.parser.move_to( Math.floor( this.currentFrame ));
	//this.x++;

	requestAnimationFrame(this.playingLoop.bind(this));
};
