/*
 * Minimal XTEST pointer driver for native window-manager tests.
 *
 * The point of the native drag/resize test is that the *operating system*
 * moves and resizes the window in response to real pointer input. Calling
 * BrowserWindow.setBounds() would prove nothing about the OS frame, so this
 * helper injects genuine pointer motion and button events through the XTEST
 * extension instead. It is compiled on demand by the test; nothing here is
 * shipped in the product.
 *
 *   xtest-pointer pos                       print the pointer position
 *   xtest-pointer move X Y                  move the pointer
 *   xtest-pointer drag X1 Y1 X2 Y2 STEPS    press button 1, move, release
 *   xtest-pointer selftest                  print "ok" if this display really
 *                                           honours injected pointer input
 *
 * The self-test exists because the XTEST extension can be present and answer
 * every call successfully while the display server silently discards the
 * events (XWayland under some compositors does exactly that). A test that
 * cannot move the pointer must fail and say why, not report a pass.
 */
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static Display *open_display(void) {
  Display *display = XOpenDisplay(NULL);
  if (!display) {
    fprintf(stderr, "xtest-pointer: cannot open DISPLAY\n");
    exit(2);
  }
  int event_base, error_base, major, minor;
  if (!XTestQueryExtension(display, &event_base, &error_base, &major, &minor)) {
    fprintf(stderr, "xtest-pointer: XTEST extension is unavailable\n");
    exit(3);
  }
  return display;
}

/*
 * Pointer motion is injected with XWarpPointer and the button transitions with
 * XTEST. On this host (XWayland under mutter) XTestFakeMotionEvent and
 * XTestFakeRelativeMotionEvent are accepted but leave the pointer where it
 * was, while a warp really moves it and really delivers motion to whatever the
 * window manager is tracking. Both are genuine pointer input to the X server;
 * neither asks the window to move.
 */
static void move_to(Display *display, int x, int y) {
  XWarpPointer(display, None, DefaultRootWindow(display), 0, 0, 0, 0, x, y);
  XTestFakeMotionEvent(display, -1, x, y, CurrentTime);
  XSync(display, False);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: xtest-pointer pos|move|drag ...\n");
    return 1;
  }
  Display *display = open_display();

  if (strcmp(argv[1], "selftest") == 0) {
    Window root_return, child_return;
    int start_x = 0, start_y = 0, win_x = 0, win_y = 0, now_x = 0, now_y = 0;
    unsigned int mask = 0;
    XQueryPointer(display, DefaultRootWindow(display), &root_return, &child_return,
                  &start_x, &start_y, &win_x, &win_y, &mask);
    XTestFakeMotionEvent(display, -1, start_x + 2, start_y + 2, CurrentTime);
    XSync(display, False);
    int honoured = 0;
    for (int attempt = 0; attempt < 20; attempt++) {
      usleep(25000);
      XQueryPointer(display, DefaultRootWindow(display), &root_return, &child_return,
                    &now_x, &now_y, &win_x, &win_y, &mask);
      if (now_x != start_x || now_y != start_y) {
        honoured = 1;
        break;
      }
    }
    if (honoured) {
      XWarpPointer(display, None, DefaultRootWindow(display), 0, 0, 0, 0, start_x, start_y);
      XSync(display, False);
      printf("ok\n");
    } else {
      printf("unsupported: XTEST pointer motion is accepted but not applied\n");
    }
    XCloseDisplay(display);
    return honoured ? 0 : 4;
  } else if (strcmp(argv[1], "pos") == 0) {
    Window root_return, child_return;
    int root_x = 0, root_y = 0, win_x = 0, win_y = 0;
    unsigned int mask = 0;
    XQueryPointer(display, DefaultRootWindow(display), &root_return, &child_return,
                  &root_x, &root_y, &win_x, &win_y, &mask);
    printf("%d %d\n", root_x, root_y);
  } else if (strcmp(argv[1], "move") == 0 && argc == 4) {
    move_to(display, atoi(argv[2]), atoi(argv[3]));
  } else if (strcmp(argv[1], "drag") == 0 && argc == 7) {
    int x1 = atoi(argv[2]), y1 = atoi(argv[3]);
    int x2 = atoi(argv[4]), y2 = atoi(argv[5]);
    int steps = atoi(argv[6]);
    if (steps < 1) steps = 1;

    move_to(display, x1, y1);
    usleep(150000);
    XTestFakeButtonEvent(display, 1, True, CurrentTime);
    XSync(display, False);
    usleep(150000);
    for (int step = 1; step <= steps; step++) {
      move_to(display, x1 + (x2 - x1) * step / steps, y1 + (y2 - y1) * step / steps);
      usleep(25000);
    }
    usleep(200000);
    XTestFakeButtonEvent(display, 1, False, CurrentTime);
    XSync(display, False);
    usleep(150000);
  } else {
    fprintf(stderr, "xtest-pointer: bad arguments\n");
    XCloseDisplay(display);
    return 1;
  }

  XCloseDisplay(display);
  return 0;
}
