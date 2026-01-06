
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { decode, decodeAudioData, createBlob } from './services/audioUtils';
import { Transcription, ConnectionStatus } from './types';

// Aina 动态人物组件
const AinaAvatar: React.FC<{ isSpeaking: boolean; isListening: boolean; audioVolume: number; isConnected: boolean }> = ({ isSpeaking, isListening, audioVolume, isConnected }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 监控连接状态，确保视频在点击后能够播放
  useEffect(() => {
    if (isConnected && videoRef.current) {
      videoRef.current.play().catch(console.error);
    }
  }, [isConnected]);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* 动态氛围背景 */}
      <div className="absolute inset-0">
        <div className={`absolute top-[10%] left-[10%] w-[60%] h-[60%] rounded-full blur-[160px] transition-all duration-1000 ${isSpeaking ? 'bg-pink-500/15' : 'bg-cyan-500/10'} animate-pulse-soft`} />
        <div className="absolute bottom-[10%] right-[10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-[140px]" />
      </div>

      {/* 视频容器 */}
      <div className="relative z-10 w-full max-w-[600px] aspect-square rounded-[80px] overflow-hidden video-frame animate-float-character">
        <div className="video-glow" />
        
        {/* 东亚年轻女性高清动态视频源 (Pexels) */}
        <video 
          ref={videoRef}
          autoPlay 
          loop 
          muted 
          playsInline 
          poster="https://images.pexels.com/photos/1462637/pexels-photo-1462637.jpeg?auto=compress&cs=tinysrgb&w=1200"
          className="w-full h-full object-cover transition-opacity duration-1000"
        >
          {/* 这里使用一个非常稳定的高清人物视频 URL */}
          <source src="https://player.vimeo.com/external/475454653.sd.mp4?s=330c88569c7ed6779435b0d00f72782b1307675f&profile_id=165&oauth2_token_id=57447761" type="video/mp4" />
        </video>
        
        {/* 全息效果覆盖 */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent opacity-60" />
        
        {/* 说话时的音量震荡反馈 (面部光影) */}
        {isSpeaking && (
          <div 
            className="absolute inset-0 bg-pink-400/5 mix-blend-screen transition-opacity duration-75 pointer-events-none"
            style={{ opacity: audioVolume * 0.8 }}
          />
        )}
      </div>

      {/* 底部 HUD 装饰项 */}
      <div className="absolute bottom-10 flex flex-col items-center gap-4 z-20">
        <div className="px-8 py-3 rounded-full glass-panel border border-white/10 flex items-center gap-4 shadow-2xl">
          <div className="flex gap-1 h-5 items-center">
            {[...Array(8)].map((_, i) => (
              <div 
                key={i} 
                className={`w-0.5 rounded-full bg-pink-400 transition-all ${isSpeaking ? '' : 'h-1 opacity-30'}`}
                style={{ height: isSpeaking ? `${40 + Math.random() * 60}%` : '4px' }}
              />
            ))}
          </div>
          <span className="text-[10px] font-bold text-white/70 tracking-[0.4em] uppercase">
            {isSpeaking ? "Aina Speaking" : isListening ? "Listening..." : "Ready to Sync"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);
  
  const audioContextIn = useRef<AudioContext | null>(null);
  const audioContextOut = useRef<AudioContext | null>(null);
  const analyserOut = useRef<AnalyserNode | null>(null);
  const nextStartTime = useRef(0);
  const sources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // 音量分析
  useEffect(() => {
    let ani: number;
    const analyze = () => {
      if (analyserOut.current && isSpeaking) {
        const data = new Uint8Array(analyserOut.current.frequencyBinCount);
        analyserOut.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioVolume(avg / 128);
      } else {
        setAudioVolume(0);
      }
      ani = requestAnimationFrame(analyze);
    };
    analyze();
    return () => cancelAnimationFrame(ani);
  }, [isSpeaking]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) sessionRef.current.close();
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    sources.current.forEach(s => s.stop());
    sources.current.clear();
    sessionRef.current = null;
    scriptProcessorRef.current = null;
    streamRef.current = null;
    nextStartTime.current = 0;
    setStatus(ConnectionStatus.DISCONNECTED);
    setIsSpeaking(false);
    setIsListening(false);
  }, []);

  const startSession = async () => {
    setErrorMessage(null);
    try {
      setStatus(ConnectionStatus.CONNECTING);
      
      // 初始化音频上下文
      audioContextIn.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOut.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      analyserOut.current = audioContextOut.current.createAnalyser();
      analyserOut.current.connect(audioContextOut.current.destination);

      await audioContextIn.current.resume();
      await audioContextOut.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            setIsListening(true);
            const source = audioContextIn.current!.createMediaStreamSource(stream);
            const script = audioContextIn.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = script;
            script.onaudioprocess = (e) => {
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) }));
            };
            source.connect(script);
            script.connect(audioContextIn.current!.destination);
          },
          onmessage: async (msg) => {
            if (msg.serverContent?.outputTranscription) {
              setTranscriptions(prev => [...prev, { role: 'model', text: msg.serverContent!.outputTranscription!.text, timestamp: Date.now() }]);
            }
            if (msg.serverContent?.inputTranscription) {
              setTranscriptions(prev => [...prev, { role: 'user', text: msg.serverContent!.inputTranscription!.text, timestamp: Date.now() }]);
            }
            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && audioContextOut.current) {
              setIsSpeaking(true);
              const ctx = audioContextOut.current;
              nextStartTime.current = Math.max(nextStartTime.current, ctx.currentTime);
              const buf = await decodeAudioData(decode(audio), ctx, 24000, 1);
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(analyserOut.current!);
              src.onended = () => {
                sources.current.delete(src);
                if (sources.current.size === 0) setIsSpeaking(false);
              };
              src.start(nextStartTime.current);
              nextStartTime.current += buf.duration;
              sources.current.add(src);
            }
            if (msg.serverContent?.interrupted) {
              sources.current.forEach(s => s.stop());
              sources.current.clear();
              nextStartTime.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (err) => {
            console.error(err);
            setErrorMessage("Connection Error: Aina is temporarily unavailable.");
            setStatus(ConnectionStatus.ERROR);
            stopSession();
          },
          onclose: () => stopSession()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: 'Kore' } // 切换为 Kore，提供甜美的女性声音
            } 
          },
          systemInstruction: '你是一个 20 岁左右的东亚女孩，名字叫 Aina (爱奈)。你现在的形象是一个漂亮、亲切、充满朝气的少女。你的声音非常甜美。你喜欢和人交流，性格开朗大方。你精通中文、日语和英语，会根据对方的语言习惯自然切换。对话时请展现出年轻女孩的活力，多使用语气词（如“好哒”、“嗯嗯”、“原来是这样呀”），像好朋友一样跟我聊天。',
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setErrorMessage("Microphone access denied.");
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white">
      {/* 顶部标题栏 */}
      <header className="px-12 py-10 flex justify-between items-center z-50">
        <div className="flex items-center gap-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-cyan-500 flex items-center justify-center font-black text-2xl shadow-[0_0_30px_rgba(236,72,153,0.3)]">A</div>
          <div>
            <h1 className="text-xl font-bold tracking-widest text-white/90">AINA AI</h1>
            <p className="text-[8px] font-bold text-white/30 tracking-[0.5em] uppercase">Humanoid Interface v2.5</p>
          </div>
        </div>
        
        <div className={`px-5 py-2 rounded-full text-[10px] font-bold tracking-widest border transition-all ${
          status === ConnectionStatus.CONNECTED ? 'border-pink-500/40 bg-pink-500/10 text-pink-400' : 'border-white/5 text-white/20'
        }`}>
          {status}
        </div>
      </header>

      {/* 主界面 */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden px-12 pb-12 gap-10">
        {/* 数字人显示区 */}
        <div className="flex-[3] relative rounded-[60px] overflow-hidden flex items-center justify-center">
          <AinaAvatar 
            isSpeaking={isSpeaking} 
            isListening={isListening && status === ConnectionStatus.CONNECTED} 
            audioVolume={audioVolume}
            isConnected={status === ConnectionStatus.CONNECTED}
          />
        </div>

        {/* 聊天记录区 */}
        <div className="flex-1 glass-panel rounded-[50px] flex flex-col overflow-hidden border border-white/5">
          <div className="px-10 py-8 border-b border-white/5 bg-white/5 flex justify-between items-center">
            <h2 className="text-[10px] font-bold text-white/30 tracking-[0.4em] uppercase">Log history</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-10 space-y-8 scrollbar-hide">
            {transcriptions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-white/10 text-xs text-center px-10 italic leading-loose">
                点击下方按钮开启对话，Aina 正在等待与你见面。
              </div>
            ) : (
              transcriptions.map((t, idx) => (
                <div key={idx} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
                  <span className="text-[8px] font-bold text-white/20 mb-2 uppercase tracking-tighter">
                    {t.role === 'user' ? 'You' : 'Aina'}
                  </span>
                  <div className={`max-w-[90%] rounded-2xl px-5 py-3 text-sm leading-relaxed ${
                    t.role === 'user' 
                      ? 'bg-white text-black font-medium' 
                      : 'bg-white/5 text-white/80 border border-white/10'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* 底部控制 */}
      <footer className="h-44 flex flex-col items-center justify-center z-50 relative pb-10">
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none" />
        
        <button
          onClick={status === ConnectionStatus.CONNECTED ? stopSession : startSession}
          disabled={status === ConnectionStatus.CONNECTING}
          className={`group relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-700 transform active:scale-95 z-50 ${
            status === ConnectionStatus.CONNECTED 
              ? 'bg-white text-black shadow-[0_0_60px_rgba(255,255,255,0.2)]' 
              : 'bg-pink-600 text-white shadow-[0_0_40px_rgba(236,72,153,0.3)] hover:scale-105'
          }`}
        >
          {status === ConnectionStatus.CONNECTED ? (
            <div className="w-8 h-8 bg-black rounded-lg" />
          ) : status === ConnectionStatus.CONNECTING ? (
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-white" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v8a3 3 0 006 0V5a3 3 0 00-3-3z" />
            </svg>
          )}
        </button>
        <p className="mt-6 text-[10px] font-bold text-white/20 tracking-[0.5em] uppercase z-50">
          {status === ConnectionStatus.CONNECTED ? 'Disconnect' : 'Connect to Aina'}
        </p>
      </footer>

      {/* 报错 */}
      {errorMessage && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 glass-panel border-pink-500/50 text-pink-200 px-10 py-5 rounded-full shadow-4xl z-[100] animate-in fade-in slide-in-from-top-6 flex items-center gap-4">
          <div className="w-2 h-2 bg-pink-500 rounded-full animate-ping" />
          <span className="text-xs font-bold tracking-widest">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-white/40 hover:text-white ml-2 font-black">✕</button>
        </div>
      )}
    </div>
  );
}
