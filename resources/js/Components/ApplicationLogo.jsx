import React from 'react';

export default function ApplicationLogo({ 
    className = '', 
    size = 'default', // 'sm', 'default', 'lg', 'xl'
    showSubtitle = true,
    dark = false,
    ...props
}) {
    const sizeConfig = {
        sm: {
            titleSize: 'text-lg',
            titleSpacing: 'tracking-[0.5px]',
            subSize: 'text-[7.5px]',
            subSpacing: 'tracking-[2px]',
            subMargin: 'mt-0.5',
        },
        default: {
            titleSize: 'text-2xl sm:text-[26px]',
            titleSpacing: 'tracking-[0.8px]',
            subSize: 'text-[8.5px] sm:text-[9.5px]',
            subSpacing: 'tracking-[2.5px] sm:tracking-[3px]',
            subMargin: 'mt-1',
        },
        lg: {
            titleSize: 'text-4xl sm:text-[44px]',
            titleSpacing: 'tracking-[1px]',
            subSize: 'text-[11px] sm:text-[12px]',
            subSpacing: 'tracking-[3.5px]',
            subMargin: 'mt-2',
        },
        xl: {
            titleSize: 'text-5xl sm:text-[56px]',
            titleSpacing: 'tracking-[1.2px]',
            subSize: 'text-[13px] sm:text-[14px]',
            subSpacing: 'tracking-[4px]',
            subMargin: 'mt-2.5',
        },
    }[size] || {
        titleSize: 'text-2xl sm:text-[26px]',
        titleSpacing: 'tracking-[0.8px]',
        subSize: 'text-[9px] sm:text-[10px]',
        subSpacing: 'tracking-[2.8px]',
        subMargin: 'mt-1',
    };

    return (
        <div className={`inline-flex flex-col text-left justify-center select-none ${className}`} {...props}>
            {/* Primary Brand Typography: "Inertia POS" in Cormorant Garamond */}
            <h1
                className={`font-bold leading-none m-0 ${sizeConfig.titleSize} ${sizeConfig.titleSpacing}`}
                style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontWeight: 700,
                }}
            >
                <span style={{ color: dark ? '#FFFFFF' : '#0B2545' }}>Inertia </span>
                <span style={{ color: '#B8860B' }}>POS</span>
            </h1>

            {/* Supporting Subtitle: "INERTIA DIGITAL SOLUTIONS" in Manrope */}
            {showSubtitle && (
                <p
                    className={`font-medium uppercase leading-none truncate ${sizeConfig.subSize} ${sizeConfig.subSpacing} ${sizeConfig.subMargin}`}
                    style={{
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: 500,
                        color: dark ? '#CBD5E1' : '#5F5E5A',
                    }}
                >
                    INERTIA DIGITAL SOLUTIONS
                </p>
            )}
        </div>
    );
}
