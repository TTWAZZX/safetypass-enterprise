import React from 'react';

interface SkeletonProps {
  className?: string;
}

const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={`
        relative overflow-hidden 
        animate-pulse rounded-2xl bg-slate-200 
        before:absolute before:inset-0 
        before:-translate-x-full 
        before:animate-[shimmer_2s_infinite] 
        before:bg-gradient-to-r 
        before:from-transparent 
        before:via-white/20 
        before:to-transparent
        ${className}
      `}
    />
  );
};

export default Skeleton;