import { currentUser, requireUser, endSession, registerUser, registerGuest, loginUser, rateLimit } from '@/lib/server/auth';
import { deviceState, forgetDeviceAccount, loginFromDevice, logoutDevice, sessionHeaders } from '@/lib/server/device-auth';
import { checkOrigin, readJson, jsonResponse, errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    if ((await context.params).action !== 'me') throw new HttpError('接口不存在。', 404);
    checkOrigin(request, false);
    return jsonResponse({ user: currentUser(request), device:deviceState(request) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    const body = await readJson(request);
    if (action === 'logout') {
      const headers = logoutDevice(request,body.forgetDevice === true);
      return jsonResponse({ ok:true, device:deviceState(request) },200,headers);
    }
    if (action === 'forget-device-account') return jsonResponse(forgetDeviceAccount(request,body.userId));
    if (action === 'remember-device') {
      const user = requireUser(request);
      rateLimit(`remember-device:${user.id}`,60,60*60*1000);
      const headers = sessionHeaders(user,request);
      endSession(request);
      return jsonResponse({user},200,headers);
    }
    if (!['register', 'quick-register', 'login', 'device-login'].includes(action)) throw new HttpError('接口不存在。', 404);
    const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
    const registration = action === 'register' || action === 'quick-register';
    rateLimit(`${registration ? 'register' : action}:ip:${address}`, registration ? 20 : 60, 60 * 60 * 1000);
    const existing = action === 'quick-register' ? currentUser(request) : null;
    const user = existing || (action === 'register' ? await registerUser(body) : action === 'quick-register' ? await registerGuest() : action === 'device-login' ? loginFromDevice(request,body.userId) : await loginUser(body));
    return jsonResponse({ user }, registration && !existing ? 201 : 200,sessionHeaders(user,request));
  } catch (error) { return errorResponse(error); }
}
