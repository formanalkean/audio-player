import React, { useState, useRef, useEffect, useCallback } from 'react';
import './AudioPlayer.css';

interface KnobConfig {
  label: string;
  min: number;
  max: number;
  unit: string;
}

const KNOB_CONFIGS: KnobConfig[] = [
  { label: 'Volume', min: 0, max: 100, unit: '%' },
  { label: 'Bass', min: -12, max: 12, unit: 'dB' },
  { label: 'Mid', min: -12, max: 12, unit: 'dB' },
  { label: 'Treble', min: -12, max: 12, unit: 'dB' },
];

const THEMES = [
  'default', 'blue', 'purple', 'red', 'gold', 'green',
  'retro', 'midnight', 'sunset', 'forest', 'ice', 'neon'
] as const;

type Theme = typeof THEMES[number];

interface Song {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl?: string;
}

interface ExtendedAudioElement extends HTMLAudioElement {
  audioContext?: AudioContext;
  bassFilter?: BiquadFilterNode;
  midFilter?: BiquadFilterNode;
  trebleFilter?: BiquadFilterNode;
  monoMerger?: ChannelMergerNode;
}

const AudioPlayer: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMono, setIsMono] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [knobValues, setKnobValues] = useState([270, 0, 0, 0]);
  const [activeKnob, setActiveKnob] = useState<number | null>(null);
  const [displayValues, setDisplayValues] = useState([100, 0, 0, 0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const lastAngleRef = useRef<number[]>([0, 0, 0, 0]);
  const [currentTheme, setCurrentTheme] = useState<Theme>('default');
  const audioRef = useRef<ExtendedAudioElement>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleKnobMouseDown = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault(); // Prevent text selection
    setActiveKnob(index);
    
    const knob = event.currentTarget.getBoundingClientRect();
    const centerX = knob.left + knob.width / 2;
    const centerY = knob.top + knob.height / 2;
    
    // Store the initial mouse position relative to the center
    lastAngleRef.current[index] = Math.atan2(
      event.clientY - centerY,
      event.clientX - centerX
    ) * (180 / Math.PI);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      
      // Calculate the new angle based on current mouse position
      const newAngle = Math.atan2(
        moveEvent.clientY - centerY,
        moveEvent.clientX - centerX
      ) * (180 / Math.PI);

      // Calculate the change in angle
      let deltaAngle = newAngle - lastAngleRef.current[index];
      
      // Handle angle wrapping
      if (deltaAngle > 180) deltaAngle -= 360;
      if (deltaAngle < -180) deltaAngle += 360;

      // Update the knob value
      setKnobValues(prev => {
        const newValues = [...prev];
        newValues[index] = Math.min(270, Math.max(0, prev[index] + deltaAngle));
        
        // Update display values based on rotation
        const config = KNOB_CONFIGS[index];
        const range = config.max - config.min;
        const normalizedRotation = newValues[index] / 270;
        const newDisplayValue = Math.round(config.min + (range * normalizedRotation));
        
        setDisplayValues(prevDisplay => {
          const newDisplayValues = [...prevDisplay];
          newDisplayValues[index] = newDisplayValue;
          return newDisplayValues;
        });
        
        return newValues;
      });

      lastAngleRef.current[index] = newAngle;
    };

    const handleMouseUp = () => {
      setActiveKnob(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const cleanupAudioUrl = (url: string | undefined) => {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsLoading(true);
    try {
      // Clean up existing playlist URLs
      playlist.forEach(song => cleanupAudioUrl(song.audioUrl));
      
      const newPlaylist: Song[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const audioUrl = URL.createObjectURL(file);
        const title = file.name.replace(/\.[^/.]+$/, "");
        
        newPlaylist.push({
          title: title,
          artist: "Unknown Artist",
          album: "Unknown Album",
          coverUrl: "https://picsum.photos/200",
          audioUrl: audioUrl
        });
      }
      
      setPlaylist(newPlaylist);
      setCurrentSongIndex(0);
      setCurrentSong(newPlaylist[0]);
      
      // Load the first song and set up one-time event listener for playback
      if (audioRef.current && newPlaylist[0].audioUrl) {
        const audio = audioRef.current;
        
        // Set up one-time event listener for when audio is loaded
        const playWhenLoaded = () => {
          audio.play().catch(error => {
            console.error('Error playing audio:', error);
          });
          setIsPlaying(true);
          audio.removeEventListener('loadeddata', playWhenLoaded);
        };
        
        audio.addEventListener('loadeddata', playWhenLoaded);
        audio.src = newPlaylist[0].audioUrl;
        audio.load();
      }
    } catch (error) {
      console.error('Error loading audio files:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration);
      
      // Update volume meter based on actual audio data
      const volume = audioRef.current.volume * displayValues[0] / 100;
      setVolumeLevel(volume);
    }
  };

  const handlePlayPause = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(error => {
          console.error('Error playing audio:', error);
        });
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleStop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  const playNext = useCallback(() => {
    if (currentSongIndex < playlist.length - 1) {
      const nextIndex = currentSongIndex + 1;
      setCurrentSongIndex(nextIndex);
      setCurrentSong(playlist[nextIndex]);
      
      if (audioRef.current && playlist[nextIndex].audioUrl) {
        audioRef.current.src = playlist[nextIndex].audioUrl as string;
        audioRef.current.load();
        if (isPlaying) {
          audioRef.current.play().catch(error => {
            console.error('Error playing next track:', error);
          });
        }
      }
    }
  }, [currentSongIndex, playlist, isPlaying]);

  const playPrevious = useCallback(() => {
    if (currentSongIndex > 0) {
      const prevIndex = currentSongIndex - 1;
      setCurrentSongIndex(prevIndex);
      setCurrentSong(playlist[prevIndex]);
      
      if (audioRef.current && playlist[prevIndex].audioUrl) {
        audioRef.current.src = playlist[prevIndex].audioUrl as string;
        audioRef.current.load();
        if (isPlaying) {
          audioRef.current.play().catch(error => {
            console.error('Error playing previous track:', error);
          });
        }
      }
    }
  }, [currentSongIndex, playlist, isPlaying]);

  const skipForward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(
        audioRef.current.currentTime + 5,
        audioRef.current.duration
      );
    }
  };

  const skipBackward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        audioRef.current.currentTime - 5,
        0
      );
    }
  };

  const skipToEnd = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = audioRef.current.duration;
    }
  };

  const handleNextTrack = () => {
    if (currentSongIndex < playlist.length - 1) {
      playNext();
    } else if (repeatMode === 'all') {
      setCurrentSongIndex(0);
      setCurrentSong(playlist[0]);
      if (audioRef.current && playlist[0].audioUrl) {
        audioRef.current.src = playlist[0].audioUrl;
        audioRef.current.load();
        if (isPlaying) {
          audioRef.current.play().catch(console.error);
        }
      }
    }
  };

  const handlePreviousTrack = () => {
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
    } else if (currentSongIndex > 0) {
      playPrevious();
    }
  };

  const cycleRepeatMode = () => {
    setRepeatMode(current => {
      switch (current) {
        case 'off': return 'all';
        case 'all': return 'one';
        case 'one': return 'off';
      }
    });
  };

  // Initialize audio context
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && !audio.audioContext) {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaElementSource(audio);
        
        // Create filters
        const bassFilter = audioContext.createBiquadFilter();
        const midFilter = audioContext.createBiquadFilter();
        const trebleFilter = audioContext.createBiquadFilter();
        
        // Configure filters
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 200;
        
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1000;
        midFilter.Q.value = 1;
        
        trebleFilter.type = 'highshelf';
        trebleFilter.frequency.value = 3000;
        
        // Connect the nodes
        source.connect(bassFilter);
        bassFilter.connect(midFilter);
        midFilter.connect(trebleFilter);
        trebleFilter.connect(audioContext.destination);
        
        // Store references
        audio.audioContext = audioContext;
        audio.bassFilter = bassFilter;
        audio.midFilter = midFilter;
        audio.trebleFilter = trebleFilter;
      } catch (error) {
        console.error('Failed to initialize audio context:', error);
      }
    }

    // Cleanup function
    return () => {
      if (audio?.audioContext) {
        audio.audioContext.close();
        audio.audioContext = undefined;
        audio.bassFilter = undefined;
        audio.midFilter = undefined;
        audio.trebleFilter = undefined;
        audio.monoMerger = undefined;
      }
    };
  }, []);

  // Handle volume and EQ changes
  useEffect(() => {
    if (audioRef.current) {
      // Volume (0-100)
      audioRef.current.volume = displayValues[0] / 100;
      
      // Update filter gains based on knob values
      if (audioRef.current.bassFilter) {
        audioRef.current.bassFilter.gain.value = displayValues[1];
      }
      if (audioRef.current.midFilter) {
        audioRef.current.midFilter.gain.value = displayValues[2];
      }
      if (audioRef.current.trebleFilter) {
        audioRef.current.trebleFilter.gain.value = displayValues[3];
      }
    }
  }, [displayValues]);

  // Handle mono/stereo switch
  useEffect(() => {
    if (audioRef.current?.audioContext) {
      const context = audioRef.current.audioContext;
      
      if (isMono) {
        // Create mono channel merger if it doesn't exist
        if (!audioRef.current.monoMerger) {
          const merger = context.createChannelMerger(2);
          const splitter = context.createChannelSplitter(2);
          const gain = context.createGain();
          gain.gain.value = 0.5; // Reduce gain to prevent clipping
          
          // Disconnect existing connections
          if (audioRef.current.trebleFilter) {
            audioRef.current.trebleFilter.disconnect();
          }
          
          // Connect for mono output
          audioRef.current.trebleFilter?.connect(splitter);
          splitter.connect(gain, 0);
          splitter.connect(gain, 1);
          gain.connect(merger, 0, 0);
          gain.connect(merger, 0, 1);
          merger.connect(context.destination);
          
          audioRef.current.monoMerger = merger;
        }
      } else {
        // Restore stereo
        if (audioRef.current.monoMerger) {
          audioRef.current.monoMerger.disconnect();
          audioRef.current.monoMerger = undefined;
          
          // Reconnect in stereo
          if (audioRef.current.trebleFilter) {
            audioRef.current.trebleFilter.disconnect();
            audioRef.current.trebleFilter.connect(context.destination);
          }
        }
      }
    }
  }, [isMono]);

  // Update the onEnded handler
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => {
        if (repeatMode === 'one') {
          audioRef.current!.currentTime = 0;
          audioRef.current!.play().catch(console.error);
        } else if (repeatMode === 'all' || currentSongIndex < playlist.length - 1) {
          handleNextTrack();
        }
      };
    }
  }, [repeatMode, currentSongIndex, playlist.length]);

  // Update keyboard shortcuts
  useEffect(() => {
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch(event.code) {
        case 'Space':
          event.preventDefault();
          handlePlayPause();
          break;
        case 'KeyR':
          if (event.ctrlKey) {
            event.preventDefault();
            setIsRecording(prev => !prev);
          }
          break;
        case 'KeyM':
          event.preventDefault();
          setIsMono(prev => !prev);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (event.ctrlKey) {
            handlePreviousTrack();
          } else {
            skipBackward();
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (event.ctrlKey) {
            handleNextTrack();
          } else {
            skipForward();
          }
          break;
        case 'KeyS':
          if (event.ctrlKey) {
            event.preventDefault();
            handleStop();
          }
          break;
        case 'KeyL':
          event.preventDefault();
          cycleRepeatMode();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, [handlePlayPause, handleNextTrack, handlePreviousTrack]);

  const cycleTheme = () => {
    setCurrentTheme(prev => {
      const currentIndex = THEMES.indexOf(prev);
      const nextIndex = (currentIndex + 1) % THEMES.length;
      return THEMES[nextIndex];
    });
  };

  // Cleanup audio URLs when component unmounts
  useEffect(() => {
    const currentPlaylist = playlist;
    return () => {
      currentPlaylist.forEach(song => cleanupAudioUrl(song.audioUrl));
    };
  }, [playlist]);

  return (
    <div className={`audio-player theme-${currentTheme}`}>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={playNext}
        onLoadedMetadata={handleTimeUpdate}
        onLoadedData={() => {
          if (audioRef.current) {
            audioRef.current.play().catch(error => {
              console.error('Error playing audio:', error);
            });
            setIsPlaying(true);
          }
        }}
      />
      <div className="visual-display">
        {isLoading && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
          </div>
        )}
        <div className="screen-border"></div>
        <div className="display-content">
          {currentSong ? (
            <div className="song-display">
              <div className="album-art">
                <img src={currentSong.coverUrl} alt={`${currentSong.album} cover`} />
              </div>
              <div className="song-info">
                <h2 className="song-title">{currentSong.title}</h2>
                <p className="artist-name">{currentSong.artist}</p>
                <p className="album-name">{currentSong.album}</p>
              </div>
            </div>
          ) : (
            <div className="no-song-selected">
              <div className="no-song-icon">🎵</div>
              <p className="no-song-text">No song selected</p>
            </div>
          )}
          
          <div className="digital-meters">
            <div className="time-display">
              <span className="current-time">{formatTime(currentTime)}</span>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                ></div>
              </div>
              <span className="duration">{formatTime(duration)}</span>
            </div>

            <div className="volume-meter">
              <div 
                className="meter-fill"
                style={{ transform: `scaleX(${volumeLevel})` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="controls-section">
        <div className="song-selection">
          <button 
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            title="Select Song"
          >
            <svg viewBox="0 0 24 24">
              <path d="M7 14l5-5 5 5h-3v4h-4v-4H7z M5 19h14v2H5z"/>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="file-input"
            onChange={handleFileSelect}
            multiple
          />
        </div>

        <div className="theme-button-container">
          <button 
            className="theme-button"
            onClick={cycleTheme}
            title="Change Theme"
          />
        </div>
        
        {/* Knobs Row */}
        <div className="knobs-row">
          {knobValues.map((rotation, index) => (
            <div key={index} className="knob-container">
              <div
                className={`knob ${activeKnob === index ? 'active' : ''}`}
                onMouseDown={(e) => handleKnobMouseDown(index, e)}
                tabIndex={0}
                role="slider"
                aria-label={KNOB_CONFIGS[index].label}
                aria-valuemin={KNOB_CONFIGS[index].min}
                aria-valuemax={KNOB_CONFIGS[index].max}
                aria-valuenow={displayValues[index]}
              >
                <div className="tick-marks">
                  {[...Array(28)].map((_, i) => (
                    <div 
                      key={i} 
                      className="tick" 
                      style={{ 
                        transform: `rotate(${i * 10}deg)`,
                        opacity: i % 3 === 0 ? 1 : 0.5
                      }}
                    />
                  ))}
                </div>
                <div 
                  className="knob-inner"
                  style={{ transform: `rotate(${rotation}deg)` }}
                >
                  <div className="knob-indicator"></div>
                </div>
              </div>
              <div className="knob-label">{KNOB_CONFIGS[index].label}</div>
            </div>
          ))}
        </div>

        {/* Mono/Stereo Switch */}
        <div className="audio-mode">
          <div className={`mode-switch ${isMono ? 'mono-active' : 'stereo-active'}`}>
            <div className="mode-option" onClick={() => setIsMono(true)}>
              <div className={`indicator ${isMono ? 'active' : ''}`}></div>
              <span>mono</span>
            </div>
            <div className="mode-option" onClick={() => setIsMono(false)}>
              <div className={`indicator ${!isMono ? 'active' : ''}`}></div>
              <span>stereo</span>
            </div>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="transport-controls">
          <button 
            className="transport-button" 
            onClick={handlePreviousTrack}
            title="Previous Track (Ctrl+Left)"
          >
            |◀
          </button>
          <button 
            className="transport-button" 
            onClick={skipBackward}
            title="Skip Backward 5s (Left Arrow)"
          >
            ◀◀
          </button>
          <button 
            className={`transport-button ${!isPlaying ? 'active' : ''}`} 
            onClick={handlePlayPause}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button 
            className="transport-button" 
            onClick={handleStop}
            title="Stop"
          >
            ⏹
          </button>
          <button 
            className="transport-button" 
            onClick={skipForward}
            title="Skip Forward 5s (Right Arrow)"
          >
            ▶▶
          </button>
          <button 
            className="transport-button" 
            onClick={skipToEnd}
            title="Skip to End"
          >
            ▶|
          </button>
          <button 
            className={`transport-button repeat-${repeatMode}`}
            onClick={cycleRepeatMode}
            title="Cycle Repeat Mode (L)"
          >
            {repeatMode === 'off' ? '↻' : repeatMode === 'all' ? '↻' : '1'}
          </button>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="shortcuts-help">
          <span>Shortcuts: Space (Play/Pause) • ←/→ (Skip 5s) • Ctrl+←/→ (Prev/Next) • L (Loop) • M (Mono)</span>
        </div>
      </div>
    </div>
  );
};

export default AudioPlayer;