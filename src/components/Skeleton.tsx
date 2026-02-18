import React from 'react';

interface SkeletonProps {
  className?: string;
}

// ✅ 1. Base Skeleton Component (ปรับใช้ animate-pulse เพื่อให้ทำงานได้ทันที)
const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={`
        relative overflow-hidden 
        bg-slate-200/80 rounded-2xl
        animate-pulse
        ${className || ''}
      `}
    />
  );
};

// ✅ 2. ProfileSkeleton (จำลองส่วนหัวของ UserPanel)
export const ProfileSkeleton = () => (
  <div className="w-full max-w-2xl mx-auto p-4 space-y-6">
    <div className="relative mt-16 bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row gap-5 items-center">
      {/* Avatar */}
      <Skeleton className="w-24 h-24 rounded-[1.5rem] -mt-16 md:mt-0 shadow-lg border-4 border-white" />
      
      <div className="flex-1 w-full space-y-3 pt-2 text-center md:text-left">
        {/* Name */}
        <Skeleton className="h-8 w-48 rounded-xl mx-auto md:mx-0" />
        
        {/* Badges Row */}
        <div className="flex justify-center md:justify-start gap-2">
          <Skeleton className="h-6 w-24 rounded-lg" />
          <Skeleton className="h-6 w-24 rounded-lg" />
          <Skeleton className="h-6 w-16 rounded-lg" />
        </div>
      </div>

      {/* Edit Button */}
      <div className="flex gap-2">
         <Skeleton className="w-10 h-10 rounded-xl" />
      </div>
    </div>
  </div>
);

// ✅ 3. CardSkeleton (จำลองการ์ดสถานะ Induction/Work Permit)
export const CardSkeleton = () => (
  <div className="bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4 overflow-hidden h-48 flex flex-col justify-between">
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        {/* Icon box */}
        <Skeleton className="w-14 h-14 rounded-2xl" />
        <div className="space-y-2">
          {/* Title & Subtitle */}
          <Skeleton className="h-4 w-32 rounded-lg" />
          <Skeleton className="h-3 w-20 rounded-lg" />
        </div>
      </div>
      {/* Status Badge */}
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    
    {/* Bottom section */}
    <div className="flex items-end justify-between border-t border-slate-50 pt-4">
      <div className="space-y-1.5">
        <Skeleton className="h-2 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      {/* Action button */}
      <Skeleton className="h-10 w-32 rounded-xl" />
    </div>
  </div>
);

// ✅ 4. PageSkeleton (รวมทุกอย่างเพื่อใช้ตอนโหลดหน้าแรก)
export const PageSkeleton = () => (
  <div className="min-h-screen bg-slate-50/50 flex flex-col pb-20">
    {/* Profile Section */}
    <div className="pt-4">
        <ProfileSkeleton />
    </div>

    {/* Journey Section */}
    <div className="max-w-2xl mx-auto w-full px-5 space-y-6">
      <div className="flex justify-between items-center">
         <div className="flex gap-3 items-center">
            <Skeleton className="w-1.5 h-6 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-lg" />
         </div>
         <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>

      {/* Manuals Section */}
      <div className="pt-4 space-y-4">
         <Skeleton className="h-4 w-32 rounded-lg ml-2" />
         <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-32 rounded-[1.5rem]" />
            <Skeleton className="h-32 rounded-[1.5rem]" />
         </div>
      </div>
    </div>
  </div>
);

export default Skeleton;