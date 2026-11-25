import { useState } from 'react';
import { Download, PlusSquare, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'landing';
}

export function PWAInstallButton({ variant = 'sidebar' }: PWAInstallButtonProps) {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  if (isInstalled || (!canInstall && !isIOS)) {
    return null;
  }

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  return (
    <>
      {variant === 'landing' ? (
        <button
          type="button"
          onClick={handleClick}
          className="px-4 py-2.5 rounded-2xl btn-secondary font-semibold text-[0.86rem] inline-flex items-center gap-2 transition cursor-pointer"
        >
          <Download size={15} />
          Add Shortcut
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="w-full flex items-center justify-center gap-2 rounded-xl btn-secondary px-3 py-2 text-[0.8rem] font-semibold cursor-pointer"
        >
          <Download size={15} />
          Add Shortcut
        </button>
      )}

      {showIOSModal && (
        <div
          className="fixed inset-0 z-50 bg-primary/45 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowIOSModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-surface border hairline p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt="Examiner icon"
                  className="h-10 w-10 rounded-xl border hairline shrink-0"
                />
                <div>
                  <h3 className="font-display text-lg font-semibold leading-tight">
                    Add Examiner Shortcut
                  </h3>
                  <p className="text-[0.75rem] text-primary/65">
                    Launches full-screen from your Home Screen
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                aria-label="Close"
                className="h-8 w-8 grid place-items-center rounded-xl btn-ghost cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <ol className="space-y-3 text-[0.82rem] text-primary/85">
              <li className="flex items-center gap-2.5">
                <span className="h-7 w-7 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                  <Share size={14} />
                </span>
                <span>
                  Tap <strong>Share</strong> in Safari&apos;s toolbar
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-7 w-7 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                  <PlusSquare size={14} />
                </span>
                <span>
                  Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[0.84rem] font-semibold cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
