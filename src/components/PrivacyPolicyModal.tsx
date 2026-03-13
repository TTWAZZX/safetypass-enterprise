import React from 'react';
import { X, ShieldCheck, Lock } from 'lucide-react';

interface PrivacyPolicyModalProps {
  onClose: () => void;
}

const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />
      
      {/* Modal Content */}
      <div className="bg-white w-full max-w-3xl max-h-[90svh] min-h-0 rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden relative z-10 animate-in zoom-in-95 duration-300 flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Privacy Policy</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">นโยบายการคุ้มครองข้อมูลส่วนบุคคล</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-red-500 border border-transparent hover:border-slate-100">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 md:p-8 overflow-y-auto flex-grow text-slate-600 text-xs md:text-sm leading-relaxed space-y-6">
            
            {/* 🛡️ ส่วนที่เพิ่มเติม: ระบบรักษาความปลอดภัยขั้นสูง */}
            <div className="bg-blue-50 p-5 rounded-[1.5rem] border border-blue-100 flex items-start gap-4 animate-in slide-in-from-top-4 duration-500">
              <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-lg shadow-blue-200">
                <ShieldCheck size={24} />
              </div>
              <div className="text-left">
                <h5 className="font-black text-blue-900 text-sm uppercase tracking-tight mb-1">Advanced Data Protection (Encryption at Rest)</h5>
                <p className="text-[11px] md:text-xs text-blue-700 font-medium leading-relaxed">
                  บริษัทฯ ใช้เทคโนโลยีการเข้ารหัสข้อมูลขั้นสูง **(pgcrypto Encryption)** ในการปกป้องเลขบัตรประชาชนของคุณ 
                  ข้อมูลจะถูกแปลงเป็นรหัสลับที่ไม่สามารถอ่านได้โดยตรงก่อนจัดเก็บลงฐานข้อมูล เพื่อป้องกันการเข้าถึงจากบุคคลภายนอก 
                  และพนักงานที่ไม่ได้รับอนุญาต เพื่อความปลอดภัยสูงสุดของข้อมูลส่วนบุคคลของคุณ
                </p>
              </div>
            </div>

            {/* THAI VERSION */}
            <div className="space-y-4">
                <h4 className="text-lg font-bold text-slate-900 border-l-4 border-blue-500 pl-3">นโยบายการคุ้มครองข้อมูลส่วนบุคคล (Privacy Policy)</h4>
                <p>บริษัท ไทยซัมมิท ฮาร์เนส จำกัด (มหาชน) ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของคุณ โดยนโยบายความเป็นส่วนตัวฉบับนี้ได้อธิบายแนวปฏิบัติเกี่ยวกับการเก็บรวบรวม ใช้ หรือเปิดเผยข้อมูลส่วนบุคคล รวมถึงสิทธิต่าง ๆ ของเจ้าของข้อมูลส่วนบุคคล ตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล</p>

                <h5 className="font-bold text-slate-800">การเก็บรวบรวมข้อมูลส่วนบุคคล</h5>
                <p>เราจะเก็บรวบรวมข้อมูลส่วนบุคคลที่ได้รับโดยตรงจากคุณผ่านช่องทาง ดังต่อไปนี้</p>
                <ul className="list-disc pl-5 space-y-1">
                    <li>การสมัครสมาชิก</li>
                </ul>

                <h5 className="font-bold text-slate-800">ประเภทข้อมูลส่วนบุคคลที่เก็บรวบรวม</h5>
                <ul className="list-disc pl-5 space-y-1">
                    <li><strong>ข้อมูลการติดต่อ</strong> เช่น ที่อยู่ หมายเลขโทรศัพท์ อีเมล เป็นต้น</li>
                    <li><strong>ข้อมูลทางเทคนิค</strong> เช่น IP Address, Cookie ID, ประวัติการใช้งานเว็บไซต์ (Activity Log) เป็นต้น</li>
                </ul>

                <h5 className="font-bold text-slate-800">ผู้เยาว์</h5>
                <p>หากคุณมีอายุต่ำกว่า 20 ปีหรือมีข้อจำกัดความสามารถตามกฎหมาย เราอาจเก็บรวบรวม ใช้ หรือเปิดเผยข้อมูลส่วนบุคคลของคุณ เราอาจจำเป็นต้องให้พ่อแม่หรือผู้ปกครองของคุณให้ความยินยอมหรือที่กฎหมายอนุญาตให้ทำได้ หากเราทราบว่ามีการเก็บรวบรวมข้อมูลส่วนบุคคลจากผู้เยาว์โดยไม่ได้รับความยินยอมจากพ่อแม่หรือผู้ปกครอง เราจะดำเนินการลบข้อมูลนั้นออกจากเซิร์ฟเวอร์ของเรา</p>

                <h5 className="font-bold text-slate-800">วิธีการเก็บรักษาข้อมูลส่วนบุคคล</h5>
                <p>เราจะเก็บรักษาข้อมูลส่วนบุคคลของคุณในรูปแบบเอกสารและรูปแบบอิเล็กทรอนิกส์ เราเก็บรักษาข้อมูลส่วนบุคคลของคุณ ดังต่อไปนี้</p>
                <ul className="list-disc pl-5 space-y-1">
                    <li>เซิร์ฟเวอร์บริษัทของเราในประเทศไทย</li>
                </ul>

                <h5 className="font-bold text-slate-800">การประมวลผลข้อมูลส่วนบุคคล</h5>
                <p>เราจะเก็บรวบรวม ใช้ หรือเปิดเผยข้อมูลส่วนบุคคลของคุณเพื่อวัตถุประสงค์ดังต่อไปนี้</p>
                <ul className="list-disc pl-5 space-y-1">
                    <li>เพื่อสร้างและจัดการบัญชีผู้ใช้งาน</li>
                    <li>เพื่อการบริหารจัดการภายในบริษัท</li>
                    <li>เพื่อรวบรวมข้อเสนอแนะ</li>
                </ul>

                <h5 className="font-bold text-slate-800">การเปิดเผยข้อมูลส่วนบุคคล</h5>
                <p>เราอาจเปิดเผยข้อมูลส่วนบุคคลของคุณให้แก่ผู้อื่นภายใต้ความยินยอมของคุณหรือที่กฎหมายอนุญาตให้เปิดเผยได้ ดังต่อไปนี้</p>
                <p><strong>การบริหารจัดการภายในองค์กร</strong> เราอาจเปิดเผยข้อมูลส่วนบุคคลของคุณภายในบริษัทเท่าที่จำเป็นเพื่อปรับปรุงและพัฒนาสินค้าหรือบริการของเรา เราอาจรวบรวมข้อมูลภายในสำหรับสินค้าหรือบริการต่าง ๆ ภายใต้นโยบายนี้เพื่อประโยชน์ของคุณและผู้อื่นมากขึ้น</p>

                <h5 className="font-bold text-slate-800">ระยะเวลาจัดเก็บข้อมูลส่วนบุคคล</h5>
                <p>เราจะเก็บรักษาข้อมูลส่วนบุคคลของคุณไว้ตามระยะเวลาที่จำเป็นในระหว่างที่คุณเป็นลูกค้าหรือมีความสัมพันธ์อยู่กับเราหรือตลอดระยะเวลาที่จำเป็นเพื่อให้บรรลุวัตถุประสงค์ที่เกี่ยวข้องกับนโยบายฉบับนี้ ซึ่งอาจจำเป็นต้องเก็บรักษาไว้ต่อไปภายหลังจากนั้น หากมีกฎหมายกำหนดไว้ เราจะลบ ทำลาย หรือทำให้เป็นข้อมูลที่ไม่สามารถระบุตัวตนของคุณได้ เมื่อหมดความจำเป็นหรือสิ้นสุดระยะเวลาดังกล่าว</p>

                <h5 className="font-bold text-slate-800">สิทธิของเจ้าของข้อมูลส่วนบุคคล</h5>
                <p>ภายใต้กฎหมายคุ้มครองข้อมูลส่วนบุคคล คุณมีสิทธิในการดำเนินการดังต่อไปนี้</p>
                <ul className="list-disc pl-5 space-y-2">
                    <li><strong>สิทธิขอถอนความยินยอม (right to withdraw consent):</strong> หากคุณได้ให้ความยินยอม เราจะเก็บรวบรวม ใช้ หรือเปิดเผยข้อมูลส่วนบุคคลของคุณ ไม่ว่าจะเป็นความยินยอมที่คุณให้ไว้ก่อนวันที่กฎหมายคุ้มครองข้อมูลส่วนบุคคลใช้บังคับหรือหลังจากนั้น คุณมีสิทธิที่จะถอนความยินยอมเมื่อใดก็ได้ตลอดเวลา</li>
                    <li><strong>สิทธิขอเข้าถึงข้อมูล (right to access):</strong> คุณมีสิทธิขอเข้าถึงข้อมูลส่วนบุคคลของคุณที่อยู่ในความรับผิดชอบของเราและขอให้เราทำสำเนาข้อมูลดังกล่าวให้แก่คุณ รวมถึงขอให้เราเปิดเผยว่าเราได้ข้อมูลส่วนบุคคลของคุณมาได้อย่างไร</li>
                    <li><strong>สิทธิขอถ่ายโอนข้อมูล (right to data portability):</strong> คุณมีสิทธิขอรับข้อมูลส่วนบุคคลของคุณในรูปแบบที่สามารถอ่านหรือใช้งานได้ด้วยเครื่องมืออัตโนมัติ</li>
                    <li><strong>สิทธิขอคัดค้าน (right to object):</strong> คุณมีสิทธิขอคัดค้านการเก็บรวบรวม ใช้ หรือเปิดเผยข้อมูลส่วนบุคคลของคุณในเวลาใดก็ได้</li>
                    <li><strong>สิทธิขอให้ลบหรือทำลายข้อมูล (right to erasure/destruction):</strong> คุณมีสิทธิขอลบหรือทำลายข้อมูลส่วนบุคคลของคุณหากหมดความจำเป็น</li>
                    <li><strong>สิทธิขอให้ระงับการใช้ข้อมูล (right to restriction of processing):</strong> คุณมีสิทธิขอให้ระงับการใช้ข้อมูลส่วนบุคคลชั่วคราว</li>
                    <li><strong>สิทธิขอให้แก้ไขข้อมูล (right to rectification):</strong> คุณมีสิทธิขอแก้ไขข้อมูลส่วนบุคคลของคุณให้ถูกต้อง เป็นปัจจุบัน สมบูรณ์ และไม่ก่อให้เกิดความเข้าใจผิด</li>
                    <li><strong>สิทธิร้องเรียน (right to lodge a complaint):</strong> คุณมีสิทธิร้องเรียนต่อผู้มีอำนาจตามกฎหมายที่เกี่ยวข้อง</li>
                </ul>
                <p className="mt-2">คุณสามารถใช้สิทธิของคุณในฐานะเจ้าของข้อมูลส่วนบุคคลข้างต้นได้ โดยติดต่อมาที่เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคลของเราตามรายละเอียดท้ายนโยบายนี้ เราจะแจ้งผลการดำเนินการภายในระยะเวลา 30 วัน</p>

                <h5 className="font-bold text-slate-800">การรักษาความมั่งคงปลอดภัยของข้อมูลส่วนบุคคล</h5>
                <p>เราจะรักษาความมั่นคงปลอดภัยของข้อมูลส่วนบุคคลของคุณไว้ตามหลักการ การรักษาความลับ (confidentiality) ความถูกต้องครบถ้วน (integrity) และสภาพพร้อมใช้งาน (availability)</p>

                <h5 className="font-bold text-slate-800">การแจ้งเหตุละเมิดข้อมูลส่วนบุคคล</h5>
                <p>ในกรณีที่มีเหตุละเมิดข้อมูลส่วนบุคคลของคุณเกิดขึ้น เราจะแจ้งให้สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลทราบโดยไม่ชักช้าภายใน 72 ชั่วโมง</p>

                <h5 className="font-bold text-slate-800">รายละเอียดการติดต่อ</h5>
                <p><strong>ผู้ควบคุมข้อมูลส่วนบุคคล:</strong> บริษัท ไทยซัมมิท ฮาร์เนส จำกัด (มหาชน)<br/>
                202 หมู่ 3 นิคมอุตสาหกรรมแหลมฉบัง ทุ่งสุขลา ศรีราชา ชลบุรี 20230<br/>
                อีเมล: sattaya_w@thaisummit-harness.co.th<br/>
                เว็บไซต์: www.tshpcl.com<br/>
                โทรศัพท์: 038-490760-67 ต่อ 1199</p>
            </div>

            <hr className="my-8 border-slate-200" />

            {/* ENGLISH VERSION */}
            <div className="space-y-4">
                <h4 className="text-lg font-bold text-slate-900 border-l-4 border-blue-500 pl-3">Privacy Policy for Customer</h4>
                <p>Thai Summit Harness Public Company Limited recognizes the importance of the protection of your personal data. This Privacy Policy explains our practices regarding the collection, use or disclosure of personal data including other rights of the Data Subjects in accordance with the Personal Data Protection Laws.</p>

                <h5 className="font-bold text-slate-800">Collection of Personal Data</h5>
                <p>We will collect your personal data that receive directly from you as following:</p>
                <ul className="list-disc pl-5 space-y-1">
                    <li>your account registration</li>
                </ul>

                <h5 className="font-bold text-slate-800">Types of Data Collected</h5>
                <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Contact information</strong> such as address, telephone number, e-mail address, etc.</li>
                    <li><strong>Technical data</strong> such as IP Address, Cookie ID, Activity Log, etc.</li>
                </ul>

                <h5 className="font-bold text-slate-800">Children</h5>
                <p>If you are under the age of 20 or having legal restrictions, we may collect use or disclose your personal data. We require your parents or guardian to be aware and provide consent to us or allowed by applicable laws.</p>

                <h5 className="font-bold text-slate-800">Storage of Data</h5>
                <p>We store your personal data as hard copy and soft copy on our server in Thailand.</p>

                <h5 className="font-bold text-slate-800">Use of Data</h5>
                <ul className="list-disc pl-5 space-y-1">
                    <li>To create and manage accounts</li>
                    <li>To share and manage information within organization</li>
                    <li>To gather user’s feedback</li>
                </ul>

                <h5 className="font-bold text-slate-800">Data Retention</h5>
                <p>We will retain your personal data for as long as necessary during the period you are a customer or under relationship with us, or for as long as necessary in connection with the purposes set out in this Privacy Policy.</p>

                <h5 className="font-bold text-slate-800">Data Subject Rights</h5>
                <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Withdrawal of consent</strong></li>
                    <li><strong>Data access</strong></li>
                    <li><strong>Data portability</strong></li>
                    <li><strong>Objection</strong></li>
                    <li><strong>Data erasure or destruction</strong></li>
                    <li><strong>Suspension</strong></li>
                    <li><strong>Rectification</strong></li>
                    <li><strong>Complaint lodging</strong></li>
                </ul>
                <p>You can exercise these rights as the Data Subject by contacting our Data Protection Officer as mentioned below. We will notify the result of your request within 30 days upon receipt of such request.</p>

                <h5 className="font-bold text-slate-800">Contact Information</h5>
                <p><strong>Data Controller:</strong> Thai Summit Harness Public Company Limited<br/>
                202 Moo 3 Laemchabang Industrial Estate, Thung Sukhla, Si Racha, Chon Buri, 20230<br/>
                Email: sattaya_w@thaisummit-harness.co.th<br/>
                Website: www.tshpcl.com<br/>
                Tel: 038-490760-67 / 1199</p>
            </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
            <button onClick={onClose} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-all shadow-lg active:scale-95 text-xs uppercase tracking-widest">
                Acknowledge / รับทราบ
            </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyModal;