import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function MobileScanner({ onScan, onClose }) {
    const html5QrCodeRef = useRef(null);
    const [scannedCode, setScannedCode] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        if (html5QrCodeRef.current) return;

        const html5QrCode = new Html5Qrcode("reader");
        html5QrCodeRef.current = html5QrCode;

        const startScanner = async () => {
            try {
                await html5QrCode.start(
                    { facingMode: "environment" },
                    {
                        fps: 15,
                        // REMOVED qrbox and aspectRatio!
                        // This prevents the camera from zooming/cropping on desktop
                        // and completely disables the library's "double box" shadow effect.
                    },
                    (decodedText) => {
                        setScannedCode((currentCode) => {
                            if (currentCode) return currentCode;

                            // Native vibration feedback
                            if (navigator.vibrate) navigator.vibrate(100);

                            // Pause scanner visually when code is caught
                            if (html5QrCodeRef.current.isScanning) {
                                html5QrCodeRef.current.pause(true);
                            }

                            return decodedText;
                        });
                    },
                    (scanError) => {
                        // Ignore empty frame errors
                    }
                );
            } catch (err) {
                console.error("Camera Error:", err);
                setErrorMessage("Camera permission denied or no back camera found.");
            }
        };

        const timer = setTimeout(() => {
            startScanner();
        }, 300);

        return () => {
            clearTimeout(timer);
            if (html5QrCodeRef.current?.isScanning) {
                html5QrCodeRef.current.stop().catch(console.error);
            }
            html5QrCodeRef.current = null;
        };
    }, []);

    const handleRescan = () => {
        setScannedCode(null);
        if (html5QrCodeRef.current?.isScanning) {
            html5QrCodeRef.current.resume();
        }
    };

    const handleContinue = () => {
        onScan(scannedCode);
    };

    return (
        // BACKDROP: Dark blurred background on desktop, pure black on mobile
        <div className="fixed inset-0 z-[10000] bg-black sm:bg-black/90 sm:backdrop-blur-sm flex flex-col items-center justify-center sm:p-6 animate-in fade-in duration-300">

            {/* CONTAINER: Full screen on mobile, landscape modal on desktop */}
            <div className="relative w-full h-full sm:max-w-4xl sm:h-[600px] sm:rounded-none bg-black overflow-hidden flex flex-col shadow-2xl sm:ring-1 sm:ring-white/10 animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">

                {/* Top Bar */}
                <div className="absolute top-0 left-0 w-full p-4 sm:p-6 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
                    <button onClick={onClose} className="p-2 bg-white/20 hover:bg-white/40 rounded-none text-white backdrop-blur-md transition-all active:scale-95">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="text-white font-bold tracking-widest uppercase text-xs sm:text-sm drop-shadow-md">Scan Barcode</span>
                    <div className="w-10"></div>
                </div>

                <style>{`
                    #reader {
                        width: 100% !important;
                        height: 100% !important;
                        border: none !important;
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    #reader__scan_region {
                        width: 100% !important;
                        height: 100% !important;
                        position: absolute !important;
                        background: #000 !important;
                    }
                    #reader__scan_region video {
                        object-fit: cover !important;
                        width: 100% !important;
                        height: 100% !important;
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                    }
                    #reader__dashboard_section_csr span,
                    #reader__dashboard_section_csr button,
                    #reader__dashboard_section_swaplink {
                        display: none !important;
                    }
                `}</style>

                {/* Video Container */}
                <div id="reader" className="w-full h-full z-0"></div>

                {/* Scanner Laser Animation - Adapts size for Desktop vs Mobile */}
                {!scannedCode && (
                    <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                        <div className="relative w-[250px] h-[250px] sm:w-[350px] sm:h-[350px]">
                            <div className="absolute top-0 left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_15px_4px_rgba(59,130,246,0.6)] sm:animate-[scan_2.5s_ease-in-out_infinite_alternate] animate-[scan_2s_ease-in-out_infinite_alternate]"></div>

                            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-white rounded-none"></div>
                            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-white rounded-none"></div>
                            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-white rounded-none"></div>
                            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-white rounded-none"></div>
                        </div>
                    </div>
                )}

                <style>{`
                    @keyframes scan {
                        0% { transform: translateY(0); }
                        100% { transform: translateY(250px); }
                    }
                    @media (min-width: 640px) {
                        @keyframes scan {
                            0% { transform: translateY(0); }
                            100% { transform: translateY(350px); }
                        }
                    }
                `}</style>

                {/* NATIVE ANDROID BOTTOM SHEET / DESKTOP MODAL OVERLAY */}
                {scannedCode && (
                    <div className="absolute inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 bg-white rounded-none p-6 sm:p-10 flex flex-col items-center animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] sm:shadow-2xl sm:w-full sm:max-w-sm">

                        <div className="sm:hidden w-12 h-1.5 bg-gray-200 rounded-none mb-6"></div>

                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-none flex items-center justify-center mb-4 ring-8 ring-blue-50">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h1.5v-1.5H15v-1.5h1.5v1.5h1.5v1.5h1.5v-1.5h-1.5v-1.5h-1.5v1.5h-1.5v-1.5H15v1.5h-1.5v1.5z" /></svg>
                        </div>

                        <p className="text-gray-500 font-bold text-xs uppercase tracking-widest mb-1">Barcode Scanned</p>
                        <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mb-8 tracking-tight font-mono text-center break-all">{scannedCode}</h2>

                        <div className="w-full flex flex-col gap-3">
                            <button onClick={handleContinue} className="w-full py-4 sm:py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-none font-bold sm:text-base text-lg transition-all active:scale-95 shadow-lg shadow-blue-500/30">
                                Continue
                            </button>
                            <button onClick={handleRescan} className="w-full py-4 sm:py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-none font-bold sm:text-base transition-all active:scale-95">
                                Rescan
                            </button>
                        </div>
                    </div>
                )}

                {errorMessage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/95 p-6 text-white text-center z-50 backdrop-blur-md">
                        <p className="font-bold">{errorMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
}