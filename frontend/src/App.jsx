import React, { useState, useRef } from 'react';

export default function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const videoRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 100 * 1024 * 1024) {
        setError('ファイルサイズは100MB以下にしてください。');
        return;
      }
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setResult(null);
      setError('');
    }
  };

  const handleAnalyze = async () => {
    if (!videoFile) return;
    setIsAnalyzing(true);
    setError('');
    const formData = new FormData();
    formData.append('video', videoFile);

    try {
      const response = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '解析に失敗しました。');
      setResult(data);
    } catch (err) {
      setError(`エラー: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const seekTo = (seconds) => {
    if (videoRef.current && seconds != null) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(e => console.log('Auto-play prevented', e));
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 p-6 font-sans">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-slate-800">Drip Analyzer (ハンドドリップAI解析)</h1>
        
        <div className="bg-white p-6 rounded-lg shadow mb-8 border border-gray-200">
          <input 
            type="file" 
            accept="video/*" 
            onChange={handleFileChange} 
            className="mb-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" 
          />
          {videoUrl && (
            <video 
              ref={videoRef} 
              src={videoUrl} 
              controls 
              className="w-full max-h-[400px] bg-black rounded-lg shadow-inner mb-4" 
            />
          )}
          <button 
            onClick={handleAnalyze} 
            disabled={!videoFile || isAnalyzing}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all shadow ${isAnalyzing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isAnalyzing ? '動画をAI解析中...（1〜2分かかります）' : '動画を解析する'}
          </button>
          {error && <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">{error}</div>}
        </div>

        {result && (
          <div className="space-y-8">
            <section className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <h2 className="text-xl font-bold border-b pb-2 mb-4">抽出サマリー</h2>
              <p className="text-lg mb-4">総抽出時間: <span className="font-bold text-blue-600">{result.totalDurationSeconds ?? 0}秒</span></p>
              {result.limitations && result.limitations.length > 0 && (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded">
                  <h3 className="font-bold text-amber-800 mb-1 text-sm">解析の制限・不可項目</h3>
                  <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                    {result.limitations.map((limit, i) => <li key={i}>{limit}</li>)}
                  </ul>
                </div>
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <section className="bg-white p-6 rounded-lg shadow border border-gray-200">
                <h2 className="text-xl font-bold border-b pb-2 mb-4">注湯イベント</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 border">時間 (クリックで移動)</th>
                        <th className="p-2 border">注湯量</th>
                        <th className="p-2 border">信頼度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.pourEvents || []).map((event, idx) => (
                        <tr key={idx} className="hover:bg-blue-50 cursor-pointer border-b transition-colors" onClick={() => seekTo(event.startSeconds)}>
                          <td className="p-2 text-blue-600 underline whitespace-nowrap">
                            {event.startSeconds}s - {event.endSeconds}s
                            <div className="text-xs text-gray-400 no-underline">({event.durationSeconds}s)</div>
                          </td>
                          <td className="p-2">
                            {event.waterMassGrams !== null && event.waterMassGrams !== undefined
                              ? <span className="font-bold text-emerald-700">{event.waterMassGrams}g</span>
                              : <span className="text-gray-400">判定不可</span>}
                            <div className="text-xs text-gray-500">[{event.massType}]</div>
                          </td>
                          <td className="p-2 text-xs">
                            <span className="font-bold text-gray-700">[{event.confidence}]</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="space-y-8">
                <section className="bg-white p-6 rounded-lg shadow border border-gray-200">
                  <h2 className="text-xl font-bold border-b pb-2 mb-4">抽出工程タイムライン</h2>
                  <ul className="space-y-2">
                    {(result.phases || []).map((phase, idx) => (
                      <li key={idx} className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors" onClick={() => seekTo(phase.startSeconds)}>
                        <div className="w-24 font-bold text-sm text-gray-600">{phase.startSeconds}s - {phase.endSeconds}s</div>
                        <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-200">
                          {phase.phaseName}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="bg-white p-6 rounded-lg shadow border border-gray-200">
                  <h2 className="text-xl font-bold border-b pb-2 mb-4">コーヒー粉の動き</h2>
                  <ul className="space-y-3">
                    {(result.groundsEvents || []).map((event, idx) => (
                      <li key={idx} className="p-3 border rounded-lg cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all" onClick={() => seekTo(event.timestampSeconds)}>
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-blue-600 underline text-sm">{event.timestampSeconds}秒</span>
                          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">信頼度: {event.confidence}</span>
                        </div>
                        <p className="text-sm font-medium mb-1">{event.observation}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}