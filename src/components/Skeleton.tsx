import React from 'react';

interface SkeletonProps {
  className?: string;
}

// ✅ 1. คงฟังก์ชันเดิมของคุณไว้ แต่ปรับให้สมูทขึ้นตามแผน Visual Polish
const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={`
        relative overflow-hidden 
        bg-slate-200 rounded-2xl
        animate-shimmer
        ${className}
      `}
    />
  );
};

// ✅ 2. เพิ่ม ProfileSkeleton (โครงร่างส่วนหัวข้อผู้ใช้งาน)
export const ProfileSkeleton = () => (
  <div className="w-full max-w-2xl mx-auto p-4 space-y-6">
    <div className="relative mt-16 bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row gap-5 items-center">
      {/* Avatar */}
      <Skeleton className="w-24 h-24 rounded-[1.5rem] -mt-16 md:mt-0 shadow-lg" />
      <div className="flex-1 w-full space-y-3">
        {/* Name */}
        <Skeleton className="h-8 w-48 rounded-xl mx-auto md:mx-0" />
        <div className="flex justify-center md:justify-start gap-2">
          {/* Badges */}
          <Skeleton className="h-6 w-24 rounded-lg" />
          <Skeleton className="h-6 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  </div>
);

// ✅ 3. เพิ่ม CardSkeleton (โครงร่างการ์ดสถานะการสอบ/Permit)
export const CardSkeleton = () => (
  <div className="bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4 overflow-hidden h-48 flex flex-col justify-between">
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        {/* Icon box */}
        <Skeleton className="w-12 h-12 rounded-2xl" />
        <div className="space-y-2">
          {/* Title & Subtitle */}
          <Skeleton className="h-4 w-32 rounded-lg" />
          <Skeleton className="h-3 w-20 rounded-lg" />
        </div>
      </div>
    </div>
    {/* Bottom section */}
    <div className="flex items-end justify-between border-t border-slate-50 pt-4">
      <div className="space-y-1">
        <Skeleton className="h-2 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      {/* Action button */}
      <Skeleton className="h-10 w-32 rounded-xl" />
    </div>
  </div>
);

// ✅ 4. เพิ่ม PageSkeleton (โครงร่างหน้าจอทั้งหมดตอนโหลดครั้งแรก)
export const PageSkeleton = () => (
  <div className="min-h-screen bg-slate-50/50 flex flex-col">
    {/* Fake Nav */}
    <div className="h-16 bg-slate-900 w-full mb-8" />
    <div className="max-w-2xl mx-auto w-full px-4 space-y-8">
      <ProfileSkeleton />
      <div className="grid grid-cols-1 gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  </div>
);

export default Skeleton;