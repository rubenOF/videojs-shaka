import window from 'global/window';
import videojs from 'video.js';
import shaka from 'shaka-player';
import findKeyByValue from './findKeyByValue';
import shakaDrmConfigFromKeySystemOptions from './shakaDrmConfigFromKeySystemOptions';

/**
 * videojs-contrib-dash
 *
 * Use Shaka Player to playback DASH content inside of Video.js via a SourceHandler
 */
class ShakaHandler {
  constructor(source, tech, options = tech.options_) {
    // Do nothing if the src is falsey
    if (!source.src) {
      return;
    }

    const player = videojs(options.playerId);
    this.player = player;
    this.el_ = tech.el();

    // call updatesource hooks
    ShakaHandler.hooks('updatesource').forEach((hook) => {
      source = hook(source);
    });

    shaka.polyfill.installAll();

    // reuse an existing shaka player
    const shakaPlayer = (player.dash && player.dash.shakaPlayer) ||
      new shaka.Player(this.el_);
    this.shakaPlayer = shakaPlayer;

    player.dash = {
      shakaPlayer
    };

    tech.one('dispose', function() {
      shakaPlayer.destroy();
    });

    // reset Shaka Player if it exists
    shakaPlayer.resetConfiguration();

    ShakaHandler.hooks('beforeinitialize').forEach((hook) => {
      hook(this.player, this.shakaPlayer);
    });

    // limit ABR by player size
    player.on(['fullscreenchange'], () => { this.resize() });

    shakaPlayer.configure({
      abr: {
        enabled: true
        // videojs-contrib-hls's default initial bandwidth
        // "start playlist selection at a reasonable bandwidth for
        // broadband internet
        // 0.5 MB/s"
        // defaultBandwidthEstimate: 4194304
      }
    });

    // set up DRM
    if (source.keySystemOptions) {
      shakaPlayer.configure(shakaDrmConfigFromKeySystemOptions(source.keySystemOptions));
    }

    shakaPlayer.addEventListener('error', function(event) {
      ShakaHandler.onError(event.detail);
    });

    shakaPlayer.addEventListener('adaptation', function (a) {
      var playerEL = player.el();
      var controlBar = playerEL.parentNode.querySelector('.vjs-control-bar');
      var shakaMenuContent = controlBar.querySelector('.vjs-shaka-button');
      var selected = shakaMenuContent.querySelector('.vjs-selected');
      if (selected) {
        selected.className = selected.className.replace('vjs-selected', '');
      }

      var active = this.getVariantTracks().filter((track) => track.active === true);
      var newSelected = shakaMenuContent.querySelector('[data-id="' + active[0].id + '"]');
      newSelected.className = newSelected.className + " vjs-selected";
    });

    player.dash.representations = this.setupRepresentations();

    this.load(source.src);
  }

  static onError(error) {
    const errorCategory = findKeyByValue(shaka.util.Error.Category, error.category);
    const errorName = findKeyByValue(shaka.util.Error.Code, error.code);

    videojs.log.error(`${error.code} : ${errorCategory}, ${errorName}`);
  }

  load(sourceUrl) {
    this.shakaPlayer.load(sourceUrl).then(() => {
      this.initShakaMenus();
      // set up audio tracks
      this.setupAudioTracks();
      // set up text tracks
      this.setupTextTracks();
      // limit ABR by player size
      this.resize();

    }).catch(ShakaHandler.onError);
  }

  setupTextTracks() {
    const player = this.player;
    const shakaPlayer = this.shakaPlayer;

    const textTracks = shakaPlayer.getVariantTracks()
      .filter((track) => track.type === 'text');

    // add the shaka player tracks to the video.js player
    textTracks.forEach(function({
      active,
      language
    }) {
      player.addRemoteTextTrack({
        default: active,
        label: language,
        language
      }, true);
    });

    // sync the video.js track selection with the shaka player
    const updateActiveShakaTrack = function() {
      for (let { mode, language } of Array.from(player.textTracks())) {
        if (mode === 'showing') {
          shakaPlayer.setTextTrackVisibility(true);
          shakaPlayer.configure({
            preferredTextLanguage: language
          });

          return;
        }
      }

      // disable track display if no text tracks are enabled
      shakaPlayer.setTextTrackVisibility(false);
      shakaPlayer.configure({
        preferredTextLanguage: ''
      });
    };

    player.textTracks().on('change', updateActiveShakaTrack);
    player.one('loadstart', () => {
      player.textTracks().off('change', updateActiveShakaTrack);
    });

    // show the active default track
    const showingTrack = textTracks.find((track) => track.active);
    for (let track of Array.from(player.textTracks())) {
      if (track.language === showingTrack.language) {
        track.mode = 'showing';
        break;
      }
    }
  }

  initShakaMenus() {
    var player = this.player;
    var shakaPlayer = this.shakaPlayer;

    // player.options_['playbackRates'] = [];
    var playerEL = player.el();
    // return;
    playerEL.className += ' vjs-shaka';
// return;
    var shakaButton = document.createElement('div');
    shakaButton.setAttribute('class', 'vjs-shaka-button vjs-menu-button vjs-menu-button-popup vjs-control vjs-icon-cog');

    var shakaMenu = document.createElement('div');
    shakaMenu.setAttribute('class', 'vjs-menu');
    shakaButton.appendChild(shakaMenu);

    var shakaMenuContent = document.createElement('ul');
    shakaMenuContent.setAttribute('class', 'vjs-menu-content');
    shakaMenu.appendChild(shakaMenuContent);

    var videoTracks = shakaPlayer.getVariantTracks();

    // var el = document.createElement('li');
    // el.setAttribute('class', 'vjs-menu-item vjs-selected');
    // var label = document.createElement('span');
    var setInnerText = this.setInnerText;

    // setInnerText(label, "Auto");
    // el.appendChild(label);
    // el.addEventListener('click', function() {
    //   var selected = shakaMenuContent.querySelector('.vjs-selected');
    //   if (selected) {
    //     selected.className = selected.className.replace('vjs-selected', '')
    //   }
    //   this.className = this.className + " vjs-selected";
    //   shakaPlayer.configure({abr: {enabled: true}});
    // });
    // shakaMenuContent.appendChild(el);

    for (var i = 0; i < videoTracks.length; ++i) {
      if (videoTracks[i].videoCodec) {
        (function() {
          var track = videoTracks[i];
          var rate = (videoTracks[i].bandwidth / 1024).toFixed(0);
          var height = videoTracks[i].height;
          var el = document.createElement('li');
          el.setAttribute('class', 'vjs-menu-item');
          el.setAttribute('data-val', rate);
          el.setAttribute('data-id', track.id);
          var label = document.createElement('span');
          setInnerText(label, height + "p (" + rate + "k)");
          el.appendChild(label);
          el.addEventListener('click', function() {
            var selected = shakaMenuContent.querySelector('.vjs-selected');
            if (selected) {
              selected.className = selected.className.replace('vjs-selected', '')
            }
            this.className = this.className + " vjs-selected";
            shakaPlayer.configure({
              abr: { enabled: false },
              restrictions: {
                minVideoBandwidth: 0,
                maxVideoBandwidth: Infinity,
                maxHeight: Infinity
              }
            });
            shakaPlayer.selectVariantTrack(track, false);
            console.log(track);
            // TODO: Make opt_clearBuffer a property of this tech
            // If above is set to true, you may wish to uncomment the below
            // player.trigger('waiting');
          })
          shakaMenuContent.appendChild(el);
        }())
      }
    }
    var controlBar = playerEL.parentNode.querySelector('.vjs-control-bar');

    if (controlBar) {
      controlBar.insertBefore(shakaButton, controlBar.lastChild);
    }
  }

  setupAudioTracks() {
    const player = this.player;
    const shakaPlayer = this.shakaPlayer;

    const audioTracks = shakaPlayer.getVariantTracks()
      .filter((track) => track.type === 'audio');

    const activeLanguage = audioTracks
      .reduce((active, track) => track.active ? track.language : active, '');

    const languages = audioTracks.reduce(function(list, track) {
      return list.indexOf(track.language) === -1 ?
        list.concat([track.language]) : list;
    }, []);

    const vjsAudioTracks = player.audioTracks();
    languages.forEach(function(language, i) {
      const active = language === activeLanguage;
      vjsAudioTracks.addTrack(
        new videojs.AudioTrack({
          enabled: active,
          id: i + '',
          kind: active ? 'main' : 'alternative',
          label: language,
          language: language
        })
      );
    });

    vjsAudioTracks.addEventListener('change', function() {
      for (let i = 0; i < vjsAudioTracks.length; i++) {
        const track = vjsAudioTracks[i];

        if (track.enabled) {
          shakaPlayer.configure({
            preferredAudioLanguage: track.language
          });

          // Stop looping
          break;
        }
      }
    });
  }

  /**
   * Creates a list of renditions that limits the range of the dash.js ABR algorithm
   */
  setupRepresentations() {
    const player = this.player;
    const shakaPlayer = this.shakaPlayer;

    /**
     * Creates a representation object that can be used as a quality level
     */
    const createRepresentation = function({ id, width, height, bandwidth }, enabledCallback) {
      const representation = {
        id: id + '',
        width,
        height,
        bandwidth,
        isEnabled_: true,
        enabled: function(enable) {
          if (enable === undefined) {
            return representation.isEnabled_;
          }

          if (enable === representation.isEnabled_) {
            return;
          }

          if (enable === true || enable === false) {
            representation.isEnabled_ = enable;
            enabledCallback();
          }
        }
      };

      return representation;
    };

    let representations = [];

    const updateBitrateRange = function() {
      const enabledRepresentations = representations
        .filter((representation) => representation.enabled());

      // disable the bitrate range limit if it's unecessary
      // or if nothing's enabled
      if (enabledRepresentations.length === representations.length ||
        enabledRepresentations.length === 0) {
        shakaPlayer.configure({
          restrictions: {
            minVideoBandwidth: 0,
            maxVideoBandwidth: Infinity,
            maxHeight: player.currentDimensions().height
          }
        });

        return;
      }

      enabledRepresentations.sort((x, y) => x.bandwidth - y.bandwidth);

      const min = enabledRepresentations[0].bandwidth;
      const max = enabledRepresentations[enabledRepresentations.length - 1].bandwidth;

      shakaPlayer.configure({
        restrictions: {
          minVideoBandwidth: min,
          maxVideoBandwidth: max,
          maxHeight: Infinity
        }
      });
    };

    return function() {
      // populate the list on the first representations() call
      representations = representations.length ? representations : shakaPlayer
        .getVariantTracks()
        .filter(({
          type
        }) => type === 'video')
        .map((track) => createRepresentation(track, updateBitrateRange));

      return representations;
    };
  }

  setInnerText(element, text) {
    if (typeof element === 'undefined') {
      return false;
    }
    var textProperty = ('innerText' in element) ? 'innerText' : 'textContent';
    try {
      element[textProperty] = text;
    } catch (anException) {
      element.setAttribute('innerText', text);
    }
  }

  resize() {
    const player = this.player;
    const shakaPlayer = this.shakaPlayer;
    const hasDisabledRepresentations = player.dash &&
      player.dash.representations &&
      player.dash.representations()
      .filter((rep) => !rep.enabled())
      .length;

    // representations have been manually set
    // ignore the player size
    if (hasDisabledRepresentations) {
      return;
    }

    if (document.fullscreenElement) {
      // remove player size limit
      shakaPlayer.configure({
        restrictions: {
          minVideoBandwidth: 0,
          maxVideoBandwidth: Infinity,
          maxHeight: Infinity
        }
      });

      return;
    }

    shakaPlayer.configure({
      restrictions: {
        minVideoBandwidth: 0,
        maxVideoBandwidth: Infinity,
        maxHeight: Infinity
      }
    });
  }

  dispose() {
    player.off(['fullscreenchange'], () => { this.resize() });
  }

  duration() {
    const duration = this.el_.duration;

    if (duration === Number.MAX_VALUE ||
      (this.shakaPlayer && this.shakaPlayer.isLive())) {
      return Infinity;
    }

    return duration;
  }

  /**
    * Get a list of hooks for a specific lifecycle
    *
    * @param {string} type the lifecycle to get hooks from
    * @param {Function=|Function[]=} hook Optionally add a hook tothe lifecycle
    * @return {Array} an array of hooks or epty if none
    * @method hooks
    */
  static hooks(type, hook) {
    ShakaHandler.hooks_[type] = ShakaHandler.hooks_[type] || [];

    if (hook) {
      ShakaHandler.hooks_[type] = ShakaHandler.hooks_[type].concat(hook);
    }

    return ShakaHandler.hooks_[type];
  }

  /**
    * Add a function hook to a specific dash lifecycle
    *
    * @param {string} type the lifecycle to hook the function to
    * @param {Function|Function[]} hook the function or array of functions to attach
    * @method hook
    */
  static hook(type, hook) {
    ShakaHandler.hooks(type, hook);
  }

  /**
    * Remove a hook from a specific dash lifecycle.
    *
    * @param {string} type the lifecycle that the function hooked to
    * @param {Function} hook The hooked function to remove
    * @return {boolean} True if the function was removed, false if not found
    * @method removeHook
    */
  static removeHook(type, hook) {
    const index = ShakaHandler.hooks(type).indexOf(hook);

    if (index === -1) {
      return false;
    }

    ShakaHandler.hooks_[type] = ShakaHandler.hooks_[type].slice();
    ShakaHandler.hooks_[type].splice(index, 1);

    return true;
  }
}

ShakaHandler.hooks_ = {};

const canHandleKeySystems = function(source) {
  // copy the source
  source = JSON.parse(JSON.stringify(source));

  if (ShakaHandler.updateSourceData) {
    videojs.log.warn('updateSourceData has been deprecated.' +
      ' Please switch to using hook("updatesource", callback).');
    source = ShakaHandler.updateSourceData(source);
  }

  // call updatesource hooks
  ShakaHandler.hooks('updatesource').forEach((hook) => {
    source = hook(source);
  });

  const videoEl = document.createElement('video');
  if (source.keySystemOptions &&
    !(navigator.requestMediaKeySystemAccess ||
      // IE11 Win 8.1
      videoEl.msSetMediaKeys)) {
    return false;
  }

  return true;
};

videojs.DashSourceHandler = function() {
  return {
    canHandleSource: function(source) {
      if (!canHandleKeySystems(source)) {
        return '';
      }

      if (videojs.DashSourceHandler.canPlayType(source.type)) {
        return 'probably';
      } else if ((/\.mpd/i).test(source.src)) {
        return 'maybe';
      } else {
        return '';
      }
    },

    handleSource: function(source, tech, options) {
      return new ShakaHandler(source, tech, options);
    },

    canPlayType: function(type) {
      return videojs.DashSourceHandler.canPlayType(type);
    }
  };
};

videojs.DashSourceHandler.canPlayType = function(type) {
  // return 'probably';
  let dashTypeRE = /^application\/dash\+xml/i;
  if (dashTypeRE.test(type)) {
    return 'probably';
  }
  if (/^application\/x-mpegURL/i.test(type)
    && !!muxjs) {
    return 'probably';
  }

  return '';
};

// Only add the SourceHandler if the browser supports MediaSourceExtensions
if (!!window.MediaSource) {
  videojs.getTech('Html5').registerSourceHandler(videojs.DashSourceHandler(), 0);
}

videojs.ShakaHandler = ShakaHandler;
export default ShakaHandler;
