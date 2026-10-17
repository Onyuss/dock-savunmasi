# Dock Savunması — APU ve savunma kulesi modelleri.
# Blender'da ekransız çalışır, modelleri parça parça (animasyon için) GLB olarak dışa aktarır.
#
#   blender -b --factory-startup -P tools/build_models.py -- assets/models
#
# Tüm ölçüler OYUN koordinatlarında yazılır (y yukarı, -z ileri, metre).
# G() bunları Blender koordinatına çevirir; glTF dışa aktarımı (y-up) geri çevirir.

import bpy
import math
import os
import sys
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'assets/models')
os.makedirs(OUT, exist_ok=True)

M = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))       # oyun → Blender dönüşümü


def G(x, y, z):
    return Vector((x, -z, y))


def game_rot(rx=0, ry=0, rz=0):
    return (M @ Euler((rx, ry, rz), 'XYZ').to_matrix() @ M.inverted()).to_euler()


# ---------------------------------------------------------------- sahne / malzeme
MATS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    for name, col, metal, rough, emit in [
        ('Frame', (0.40, 0.42, 0.43), 0.75, 0.45, None),
        ('Dark', (0.16, 0.17, 0.18), 0.70, 0.55, None),
        ('Gun', (0.30, 0.31, 0.32), 0.80, 0.40, None),
        ('Black', (0.05, 0.05, 0.05), 0.50, 0.55, None),
        ('Brass', (0.62, 0.45, 0.20), 0.90, 0.35, None),
        ('Chain', (0.05, 0.05, 0.05), 0.70, 0.45, None),
        ('Cloth', (0.18, 0.16, 0.14), 0.00, 0.95, None),
        ('Skin', (0.45, 0.30, 0.22), 0.00, 0.80, None),
        ('Stripe', (0.40, 0.42, 0.43), 0.60, 0.55, None),
        ('Rubber', (0.03, 0.03, 0.03), 0.10, 0.70, None),
        ('Screen', (0.05, 0.3, 0.12), 0.0, 0.3, (0.2, 1.0, 0.45)),
        ('Head', (1, 1, 1), 0.0, 0.3, (3.5, 3.6, 3.2)),
        ('Orange', (1, 0.5, 0.1), 0.0, 0.3, (2.5, 1.0, 0.25)),
        ('Red', (1, 0.1, 0.05), 0.0, 0.3, (3.0, 0.2, 0.1)),
        ('Green', (0.2, 1, 0.4), 0.0, 0.3, (0.4, 2.2, 0.8)),
    ]:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*col, 1)
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        if emit:
            b.inputs['Emission Color'].default_value = (*emit, 1)
            b.inputs['Emission Strength'].default_value = 1.0
        MATS[name] = m


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


class Group:
    """Aynı düğüme (pivot) bağlı parçalar; sonunda tek mesh olarak birleşir."""

    def __init__(self, name, pivot, parent=None):
        self.name = name
        self.parts = []
        self.empty = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.empty)
        self.pivot = G(*pivot)                        # dünya konumu (Blender)
        if parent:
            self.empty.parent = parent.empty
            self.empty.location = self.pivot - parent.pivot
        else:
            self.empty.location = self.pivot

    def finish(self, obj, mat, bevel, segments=4):
        obj.data.materials.append(MATS[mat])
        if bevel and bevel > 0:
            b = obj.modifiers.new('bev', 'BEVEL')
            b.width = bevel
            b.segments = segments
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(35)
            b.miter_outer = 'MITER_ARC'
        w = obj.modifiers.new('wn', 'WEIGHTED_NORMAL')
        w.keep_sharp = True
        w.weight = 50
        for p in obj.data.polygons:
            p.use_smooth = True
        self.parts.append(obj)
        return obj

    # -- ilkel parçalar (oyun koordinatları)
    def box(self, size, pos, mat='Frame', rot=(0, 0, 0), bevel=None):
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = (size[0], size[2], size[1])
        bpy.ops.object.transform_apply(scale=True)
        o.rotation_euler = game_rot(*rot)
        o.location = G(*pos)
        # Yumuşak hatlar: kısa kenarın ~%28'i kadar yuvarlatma
        return self.finish(o, mat, min(min(size) * 0.28, 0.12) if bevel is None else bevel)

    def cyl(self, r, h, pos, axis='y', mat='Dark', verts=20, rot=(0, 0, 0), r2=None, bevel=None):
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
        o = bpy.context.active_object
        base = {'y': Euler((0, 0, 0)), 'x': Euler((0, math.pi / 2, 0)), 'z': Euler((math.pi / 2, 0, 0))}[axis].to_matrix()
        o.rotation_euler = (game_rot(*rot).to_matrix() @ base).to_euler()
        o.location = G(*pos)
        return self.finish(o, mat, min(min(r, h) * 0.25, 0.08) if bevel is None else bevel)

    def link(self, a, b, t, mat='Dark', t2=None):
        A, B = G(*a), G(*b)
        d = B - A
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = (t, t2 or t, d.length)
        bpy.ops.object.transform_apply(scale=True)
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = d.to_track_quat('Z', 'Y')
        o.location = (A + B) / 2
        return self.finish(o, mat, min(t, t2 or t) * 0.3)

    def rod(self, a, b, r, mat='Brass', verts=12):
        A, B = G(*a), G(*b)
        d = B - A
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = d.to_track_quat('Z', 'Y')
        o.location = (A + B) / 2
        return self.finish(o, mat, r * 0.2)

    def tube(self, pts, r, mat='Rubber', res=10):
        cu = bpy.data.curves.new('c', 'CURVE')
        cu.dimensions = '3D'
        sp = cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            sp.points[i].co = (*G(*p), 1)
        sp.use_endpoint_u = True
        sp.order_u = min(4, len(pts))
        cu.bevel_depth = r
        cu.bevel_resolution = 2
        cu.resolution_u = res
        o = bpy.data.objects.new('t', cu)
        bpy.context.scene.collection.objects.link(o)
        select_only([o])
        bpy.ops.object.convert(target='MESH')
        return self.finish(o, mat, 0)

    def chain(self, pts, mat='Chain'):
        """Eğri boyunca dizilmiş zincir halkaları."""
        cu = bpy.data.curves.new('c', 'CURVE')
        cu.dimensions = '3D'
        sp = cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            sp.points[i].co = (*G(*p), 1)
        sp.use_endpoint_u = True
        sp.order_u = 4
        cu.resolution_u = 64
        tmp = bpy.data.objects.new('tmp', cu)
        bpy.context.scene.collection.objects.link(tmp)
        select_only([tmp])
        bpy.ops.object.convert(target='MESH')
        verts = [tmp.matrix_world @ v.co for v in tmp.data.vertices]
        bpy.data.objects.remove(tmp)
        total = sum((verts[i + 1] - verts[i]).length for i in range(len(verts) - 1))
        n = int(total / 0.12)
        acc, j, out = 0.0, 0, []
        step = total / n
        target = 0.0
        for i in range(len(verts) - 1):
            seg = (verts[i + 1] - verts[i]).length
            while acc + seg >= target and len(out) < n:
                t = (target - acc) / seg if seg > 0 else 0
                out.append((verts[i].lerp(verts[i + 1], t), (verts[i + 1] - verts[i]).normalized()))
                target += step
            acc += seg
        for k, (p, d) in enumerate(out):
            bpy.ops.mesh.primitive_cube_add(size=1)
            o = bpy.context.active_object
            o.scale = (0.2, 0.07, 0.11) if k % 2 else (0.15, 0.11, 0.12)
            bpy.ops.object.transform_apply(scale=True)
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = d.to_track_quat('Y', 'Z')
            o.location = p
            self.finish(o, mat, 0.02, 1)

    def build(self):
        """Değiştiricileri uygula, UV ver, birleştir, pivot'a göre yerleştir."""
        if not self.parts:
            return None
        for o in self.parts:
            select_only([o])
            bpy.ops.object.convert(target='MESH')
        select_only(self.parts)
        bpy.ops.object.join()
        obj = bpy.context.active_object
        obj.name = self.name + '_mesh'
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.cube_project(cube_size=1.0, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        # Pivot'a göre kaydır ve düğüme bağla
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.data.transform(Matrix.Translation(-self.pivot))
        obj.parent = self.empty
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.location = (0, 0, 0)
        self.mesh = obj
        return obj


def empty(name, parent, pos):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent.empty
    e.location = G(*pos) - parent.pivot
    return e


def bake_ao(meshes, ground=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.render.bake.target = 'VERTEX_COLORS'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.light_settings.distance = 0.9
    g = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=40)
        g = bpy.context.active_object
    for m in meshes:
        attr = m.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        m.data.color_attributes.active_color = attr
        select_only([m])
        bpy.ops.object.bake(type='AO')
    if g:
        bpy.data.objects.remove(g)


def export(name):
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT')
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# ---------------------------------------------------------------- APU
def build_apu():
    reset()
    root = Group('APU', (0, 0, 0))
    body = Group('Body', (0, 0, 0), root)

    # Bacaklar (pivot kalçada)
    legs = []
    for s, name in ((-1, 'LegL'), (1, 'LegR')):
        hx, hy, hz = s * 0.88, 2.75, 0.1
        L = Group(name, (hx, hy, hz), root)
        P = lambda x, y, z: (hx + x, hy + y, hz + z)
        L.box((0.8, 1.25, 0.92), P(0, -0.5, -0.12), rot=(0.22, 0, 0))
        L.box((0.12, 0.9, 0.7), P(s * 0.45, -0.5, -0.1), 'Dark', rot=(0.22, 0, 0))
        L.box((0.55, 0.5, 0.16), P(0, -0.4, -0.6), 'Stripe', rot=(0.22, 0, 0))
        L.cyl(0.42, 0.95, P(0, -1.15, -0.28), 'x', 'Dark', 24)
        L.cyl(0.24, 1.15, P(0, -1.15, -0.28), 'x', 'Black', 16)
        for k in range(6):
            a = k / 6 * math.pi * 2
            L.cyl(0.04, 1.0, P(0, -1.15 + math.sin(a) * 0.32, -0.28 + math.cos(a) * 0.32), 'x', 'Frame', 8)
        L.box((0.74, 1.12, 0.84), P(0, -1.8, -0.12), rot=(-0.12, 0, 0))
        L.box((0.62, 0.8, 0.14), P(0, -1.7, -0.6), 'Dark', rot=(-0.2, 0, 0))
        L.cyl(0.28, 0.85, P(0, -2.36, 0.0), 'x', 'Black', 18)
        L.box((1.05, 0.3, 1.3), P(0, -2.6, -0.2), 'Dark')
        L.box((0.46, 0.28, 0.66), P(-0.27, -2.61, -1.02))
        L.box((0.46, 0.28, 0.66), P(0.27, -2.61, -1.02))
        L.box((0.64, 0.28, 0.52), P(0, -2.61, 0.62))
        L.rod(P(s * 0.34, -0.55, 0.36), P(s * 0.34, -2.0, 0.5), 0.065, 'Brass')
        L.cyl(0.12, 0.7, P(s * 0.34, -0.75, 0.38), 'y', 'Black', 12, rot=(-0.1, 0, 0))
        L.tube([P(-s * 0.15, -0.1, 0.32), P(-s * 0.36, -0.9, 0.5), P(-s * 0.3, -1.6, 0.48), P(-s * 0.2, -2.1, 0.38)], 0.05)
        legs.append(L)

    # Kalça ve kokpit küveti
    B = body
    B.box((2.05, 0.6, 1.2), (0, 2.85, 0.1), 'Dark')
    B.cyl(0.32, 2.2, (0, 2.85, 0.1), 'x', 'Black', 20)
    B.box((1.6, 0.14, 1.3), (0, 3.15, 0.05), 'Dark')
    B.box((1.55, 0.85, 0.12), (0, 3.56, -0.64), rot=(-0.25, 0, 0))
    for s in (-1, 1):
        B.box((0.12, 1.0, 1.3), (s * 0.8, 3.62, 0.05))
        B.box((0.6, 0.14, 1.05), (s * 1.07, 3.45, 0.0), 'Black', rot=(0, 0, s * 0.55))
        B.box((0.14, 0.55, 0.95), (s * 1.14, 3.78, 0.05), 'Black', rot=(0, 0, -s * 0.35))
        B.box((0.28, 0.52, 0.07), (s * 0.45, 3.42, -0.71), 'Dark', rot=(-0.25, 0, 0))
        for k in range(4):
            B.box((0.24, 0.035, 0.05), (s * 0.45, 3.24 + k * 0.11, -0.75 - k * 0.028), 'Black', rot=(-0.25, 0, 0), bevel=0.005)
        B.box((0.2, 0.12, 0.08), (s * 0.82, 4.12, -0.62), 'Dark')
        B.box((0.16, 0.08, 0.02), (s * 0.82, 4.12, -0.665), 'Head', bevel=0.004)
        # Omuz yatakları
        B.cyl(0.36, 0.22, (s * 0.55, 4.55, 0.72), 'y', 'Black', 24)
        B.cyl(0.3, 0.1, (s * 0.55, 4.7, 0.72), 'y', 'Frame', 24)
    B.box((1.55, 1.75, 0.16), (0, 4.0, 0.66), 'Dark')
    B.box((1.25, 0.55, 0.55), (0, 4.62, 0.9))
    for k in range(5):
        B.box((1.1, 0.05, 0.08), (0, 4.42 + k * 0.1, 1.18), 'Black', bevel=0.008)
    B.box((0.9, 0.8, 0.5), (0, 3.6, 1.0), 'Dark')
    for s in (-1, 1):
        B.cyl(0.18, 0.9, (s * 0.55, 3.55, 1.15), 'y', 'Gun', 16)
    # Kafes çemberi (yalnız başın arkasında) ve yan korkuluklar
    B.tube([(-0.74, 4.05, 0.62), (-0.68, 5.0, 0.62), (0, 5.32, 0.62), (0.68, 5.0, 0.62), (0.74, 4.05, 0.62)], 0.055, 'Frame')
    for s in (-1, 1):
        B.link((s * 0.72, 4.12, 0.62), (s * 0.72, 4.12, -0.2), 0.07, 'Frame')
    # Koltuk, kumanda, ekranlar
    B.box((0.62, 0.14, 0.52), (0, 3.72, 0.25), 'Black')
    B.box((0.64, 0.9, 0.14), (0, 4.17, 0.5), 'Black')
    B.box((0.98, 0.12, 0.12), (0, 3.98, -0.36), 'Dark')
    for s in (-1, 1):
        B.box((0.1, 0.42, 0.1), (s * 0.32, 3.82, -0.36), 'Dark')
        B.box((0.08, 0.08, 0.24), (s * 0.32, 4.06, -0.42), 'Rubber')
        B.box((0.28, 0.17, 0.03), (s * 0.43, 4.2, -0.52), 'Screen', rot=(-0.35, 0, 0), bevel=0.005)

    pilot = Group('Pilot', (0, 0, 0), root)
    pilot.box((0.44, 0.56, 0.3), (0, 4.05, 0.32), 'Cloth')
    pilot.cyl(0.14, 0.3, (0, 4.52, 0.28), 'y', 'Skin', 16, r2=0.12)
    for s in (-1, 1):
        pilot.link((s * 0.24, 4.25, 0.3), (s * 0.32, 4.05, -0.38), 0.1, 'Cloth')

    # Kollar: omuzdan yükselir, dışa uzanır, dirsekten aşağı sarkar
    for s, side in ((-1, 'L'), (1, 'R')):
        S = (s * 0.55, 4.75, 0.72)
        arm = Group('Arm' + side, S, root)
        A = (s * 0.95, 6.05, 0.55)
        E = (s * 2.15, 6.15, 0.35)
        W = (s * 2.2, 4.75, 0.2)
        arm.cyl(0.26, 0.4, S, 'x', 'Dark', 20)
        arm.link(S, A, 0.26, 'Dark')
        arm.rod((S[0], S[1], S[2] + 0.2), (A[0], A[1], A[2] + 0.2), 0.06, 'Brass')
        arm.cyl(0.28, 0.42, A, 'z', 'Frame', 20)
        arm.link(A, E, 0.28, 'Dark', 0.34)
        arm.link((A[0], A[1] + 0.24, A[2]), (E[0], E[1] + 0.24, E[2]), 0.1, 'Frame')
        for k in range(1, 5):
            p = Vector(A).lerp(Vector(E), k / 5)
            arm.cyl(0.13, 0.46, (p.x, p.y, p.z), 'z', 'Black', 14)
            arm.cyl(0.05, 0.5, (p.x, p.y, p.z), 'z', 'Frame', 8)
        arm.cyl(0.3, 0.46, E, 'z', 'Frame', 20)
        arm.link(E, W, 0.32, 'Dark')
        arm.box((0.54, 0.8, 0.46), (W[0], (E[1] + W[1]) / 2 - 0.1, (E[2] + W[2]) / 2))
        arm.box((0.08, 0.6, 0.36), (W[0] + s * 0.3, (E[1] + W[1]) / 2 - 0.1, (E[2] + W[2]) / 2), 'Black')
        arm.rod((W[0] + s * 0.32, E[1] - 0.2, E[2] + 0.1), (W[0] + s * 0.32, W[1] + 0.25, W[2] + 0.1), 0.05, 'Brass')
        arm.chain([(s * 1.39, 4.1, 0.15), (s * 1.45, 3.0, 0.7), (s * 1.3, 2.6, 1.1), (s * 0.9, 3.3, 1.05), (s * 0.6, 4.4, 0.85)])

        # El (bilekte pivot): bilek mafsalı, el sırtı, kabzayı saran parmaklar, başparmak.
        # Tabanca elin iç tarafında (GX), gövdesi bileğin altında (GY).
        gun = Group('Gun' + side, W, arm)
        Wx, Wy, Wz = W
        Q = lambda x, y, z: (Wx + x, Wy + y, Wz + z)
        GX, GY = -s * 0.45, -0.62
        gun.cyl(0.24, 0.5, Q(s * 0.12, 0, 0), 'x', 'Black', 18)
        gun.box((0.3, 0.42, 0.5), Q(s * 0.1, -0.3, 0.1), 'Dark')
        gun.box((0.14, 1.2, 0.56), Q(s * 0.06, -0.95, 0.12), 'Frame')
        gun.box((0.08, 1.0, 0.42), Q(s * 0.16, -0.95, 0.12), 'Dark')
        for k in range(3):
            y = GY - 0.55 - k * 0.17
            gun.box((0.7, 0.14, 0.17), Q(-s * 0.3, y, -0.18), 'Dark')
            gun.box((0.13, 0.14, 0.42), Q(-s * 0.66, y, 0.02), 'Dark')
            gun.cyl(0.06, 0.72, Q(-s * 0.3, y, -0.27), 'x', 'Black', 10)
        gun.box((0.14, 0.14, 0.5), Q(-s * 0.04, GY - 0.12, -0.3), 'Dark', rot=(0.25, 0, 0))

        # Dev tabanca: işaret parmağı ekseninde döner (Spin), namlu bloğu geri teper (Barrels)
        SP = Q(GX, GY - 0.55, -0.1)
        spin = Group('Spin' + side, SP, gun)
        spin.box((0.66, 0.66, 2.5), Q(GX, GY, -0.8), 'Gun')
        for y in (GY + 0.18, GY, GY - 0.18):
            for ss in (-1, 1):
                spin.box((0.07, 0.1, 1.7), Q(GX + ss * 0.34, y, -1.0), 'Frame')
        spin.box((0.5, 0.08, 2.1), Q(GX, GY + 0.35, -0.85), 'Frame')
        spin.box((0.22, 0.14, 0.3), Q(GX, GY + 0.42, 0.15), 'Dark')
        spin.box((0.12, 0.16, 0.12), Q(GX, GY + 0.43, -1.9), 'Dark')
        spin.box((0.6, 0.6, 0.36), Q(GX, GY, 0.55), 'Dark')
        spin.box((0.06, 0.4, 0.8), Q(GX - s * 0.35, GY - 0.02, -0.15), 'Black')
        spin.cyl(0.05, 0.05, Q(GX - s * 0.35, GY + 0.18, -1.6), 'x', 'Red', 8)
        spin.box((0.36, 0.95, 0.46), Q(GX, GY - 0.75, 0.12), 'Gun', rot=(-0.28, 0, 0))
        for k in range(4):
            spin.box((0.38, 0.04, 0.4), Q(GX, GY - 0.45 - k * 0.15, 0.06 + k * 0.04), 'Black', rot=(-0.28, 0, 0), bevel=0.008)
        spin.box((0.34, 0.24, 0.3), Q(GX, GY - 1.32, 0.3), 'Dark', rot=(-0.28, 0, 0))
        spin.tube([Q(GX, GY - 0.3, -0.3), Q(GX, GY - 0.75, -0.62), Q(GX, GY - 1.0, -0.42), Q(GX, GY - 0.95, -0.1)], 0.045, 'Frame')
        barrels = Group('Barrels' + side, SP, spin)
        barrels.box((0.78, 0.74, 0.38), Q(GX, GY, -2.18), 'Frame')
        for bx, by, r in ((-s * 0.12, -0.08, 0.17), (s * 0.19, 0.16, 0.09)):
            barrels.cyl(r, 0.5, Q(GX + bx, GY + by, -2.5), 'z', 'Black', 20)
            barrels.cyl(r * 0.62, 0.52, Q(GX + bx, GY + by, -2.52), 'z', 'Rubber', 16)
            barrels.cyl(r * 0.8, 0.03, Q(GX + bx, GY + by, -2.76), 'z', 'Orange', 16, bevel=0.005)
        empty('Muzzle' + side + '0', barrels, Q(GX - s * 0.12, GY - 0.08, -2.85))
        empty('Muzzle' + side + '1', barrels, Q(GX + s * 0.19, GY + 0.16, -2.85))
        for g in (arm, gun, spin, barrels):
            g.build()

    for g in (body, pilot, *legs):
        g.build()
    empty('Eye', root, (0, 4.55, 0.2))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bake_ao(meshes)
    export('apu')


# ---------------------------------------------------------------- Kule
def build_turret():
    reset()
    root = Group('Turret', (0, 0, 0))
    base = Group('Base', (0, 0, 0), root)
    b = base
    b.cyl(1.5, 8.0, (0, 4, 0), 'y', 'Frame', 24, r2=1.15)
    for k in range(4):
        a = k / 4 * math.pi * 2 + math.pi / 4
        x, z = math.cos(a), math.sin(a)
        b.link((x * 2.6, 0, z * 2.6), (x * 1.5, 7.9, z * 1.5), 0.3, 'Dark')
        b.box((1.1, 0.4, 1.1), (x * 2.6, 0.2, z * 2.6), 'Dark')
    for y in (2, 4, 6):
        b.cyl(1.55 - y * 0.045, 0.25, (0, y, 0), 'y', 'Dark', 24)
    for y10 in range(8, 76, 6):
        b.box((0.9, 0.06, 0.06), (0, y10 / 10, 1.75 - y10 / 10 * 0.045), 'Dark', bevel=0.01)
    for s in (-1, 1):
        b.link((s * 0.45, 0.6, 1.8), (s * 0.45, 7.9, 1.45), 0.07, 'Dark')
    b.cyl(2.9, 0.45, (0, 8.2, 0), 'y', 'Dark', 32)
    for k in range(12):
        a = k / 12 * math.pi * 2
        b.link((math.cos(a) * 2.75, 8.4, math.sin(a) * 2.75), (math.cos(a) * 2.75, 9.4, math.sin(a) * 2.75), 0.06, 'Frame')
    b.tube([(math.cos(a / 24 * math.pi * 2) * 2.75, 9.4, math.sin(a / 24 * math.pi * 2) * 2.75) for a in range(25)], 0.05, 'Frame', 4)
    b.cyl(2.92, 0.06, (0, 8.45, 0), 'y', 'Green', 32, bevel=0.005)
    # Ayrıntılar: uyarı bandı, servis kapağı, kablolar, dipte mühimmat sandıkları
    b.cyl(1.52, 0.6, (0, 0.9, 0), 'y', 'Stripe', 24, r2=1.49)
    b.box((0.9, 1.6, 0.12), (0, 1.4, -1.48), 'Dark', rot=(-0.04, 0, 0))
    b.box((0.12, 0.3, 0.1), (0.3, 1.4, -1.56), 'Black')
    for k in range(3):
        a = 0.6 + k * 0.5
        b.tube([(math.cos(a) * 1.4, 7.8, math.sin(a) * 1.4), (math.cos(a) * 1.6, 4.5, math.sin(a) * 1.6), (math.cos(a) * 1.75, 0.3, math.sin(a) * 1.75)], 0.06)
    for x, z, r in ((-2.4, -1.2, 0.3), (-2.9, -0.2, -0.2), (2.6, -1.4, 0.5), (-2.6, -1.25, 0.32)):
        b.box((1.1, 0.6, 0.7), (x, 0.3 if r != 0.32 else 0.9, z), 'Stripe', rot=(0, r, 0))

    head = Group('Head', (0, 8.6, 0), root)
    head.cyl(1.15, 0.85, (0, 9.02, 0), 'y', 'Frame', 24, r2=1.3)
    head.box((0.75, 0.65, 0.75), (0, 9.5, 0.9), 'Dark')
    head.box((0.9, 0.12, 0.6), (0, 9.15, 1.0), 'Black')
    head.cyl(0.12, 0.25, (0.5, 9.95, 0.95), 'y', 'Red', 10)
    head.box((0.5, 0.5, 0.6), (-0.95, 9.3, 0.6), 'Dark')
    head.box((0.42, 0.06, 0.5), (-0.95, 9.58, 0.6), 'Black', bevel=0.01)
    gun = Group('Gun', (0, 9.9, 0), head)
    gun.box((1.7, 0.75, 1.5), (0, 9.9, 0), 'Gun')
    gun.box((2.5, 1.3, 0.14), (0, 10.2, -0.82), 'Stripe')
    gun.box((2.52, 0.07, 0.16), (0, 10.86, -0.82), 'Orange', bevel=0.01)
    for s in (-1, 1):
        gun.box((0.55, 0.65, 1.1), (s * 1.15, 9.8, 0.2), 'Dark')
        gun.cyl(0.13, 3.7, (s * 0.45, 9.9, -2.45), 'z', 'Black', 16, r2=0.11)
        gun.cyl(0.18, 0.9, (s * 0.45, 9.9, -1.1), 'z', 'Gun', 16)
        gun.cyl(0.17, 0.35, (s * 0.45, 9.9, -4.1), 'z', 'Frame', 16)
        gun.cyl(0.11, 0.03, (s * 0.45, 9.9, -4.29), 'z', 'Orange', 14, bevel=0.005)
        gun.chain([(s * 1.15, 9.5, 0.6), (s * 1.0, 9.0, 0.9), (s * 0.6, 9.2, 0.6), (s * 0.45, 9.7, 0.2)])
    empty('Muzzle0', gun, (-0.45, 9.9, -4.35))
    empty('Muzzle1', gun, (0.45, 9.9, -4.35))
    for g in (base, head, gun):
        g.build()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bake_ao(meshes)
    export('turret')


build_apu()
build_turret()
print('DONE')
